import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_FOLDER_FILES = 100;

type DriveTarget =
  | { kind: "file"; id: string }
  | { kind: "folder"; id: string }
  | null;

function parseDriveLink(raw: string): DriveTarget {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname) && url.hostname !== "drive.google.com") {
    return null;
  }
  const fileMatch = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url.pathname);
  if (fileMatch) return { kind: "file", id: fileMatch[1]! };
  const folderMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(url.pathname);
  if (folderMatch) return { kind: "folder", id: folderMatch[1]! };
  const idParam = url.searchParams.get("id");
  if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) {
    return { kind: "file", id: idParam };
  }
  return null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

type FolderEntry = { id: string; name: string; isFolder: boolean };

function parseEmbeddedFolder(html: string): { title: string; entries: FolderEntry[] } {
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const title = decodeHtml(titleMatch?.[1] ?? "")
    .replace(/\s*[–-]\s*Google Drive\s*$/i, "")
    .trim();
  const entries: FolderEntry[] = [];
  const chunks = html.split('flip-entry" id="entry-');
  for (const chunk of chunks.slice(1)) {
    const idMatch = /^([a-zA-Z0-9_-]+)"/.exec(chunk);
    if (!idMatch) continue;
    const titleEntry = /flip-entry-title">([^<]+)</.exec(chunk);
    const name = decodeHtml(titleEntry?.[1] ?? "");
    const isFolder = chunk.includes(`/folders/${idMatch[1]}`);
    if (name) entries.push({ id: idMatch[1]!, name: name.slice(0, 240), isFolder });
  }
  return { title, entries };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json(
      { ok: false, message: "Sessao expirada. Entre novamente." },
      { status: 401 },
    );
  }
  const { project } = await getActiveProject(data.user.id);
  if (!project) {
    return NextResponse.json(
      { ok: false, message: "Nenhum projeto ativo selecionado." },
      { status: 400 },
    );
  }
  if (!["owner", "administrator", "editor"].includes(project.role)) {
    return NextResponse.json(
      { ok: false, message: "Seu papel nao permite importar criativos neste projeto." },
      { status: 403 },
    );
  }
  const database = getDatabase();
  const actor = (
    await database.pool.query<{ id: string }>(
      `select id from public.users where auth_user_id = $1 and status = 'active' limit 1`,
      [data.user.id],
    )
  ).rows[0];
  if (!actor) {
    return NextResponse.json(
      { ok: false, message: "Usuario nao encontrado neste projeto." },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    url?: string;
    folder_id?: string;
  } | null;
  const target = body?.url ? parseDriveLink(body.url) : null;
  if (!target) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Link nao reconhecido. Cole o link de um arquivo ou de uma pasta do Google Drive.",
      },
      { status: 400 },
    );
  }
  let folderId: string | null = null;
  const folderRaw = String(body?.folder_id ?? "").trim();
  if (folderRaw) {
    const folder = (
      await database.pool.query<{ id: string }>(
        `select id from public.creative_folders where id = $1 and project_id = $2 limit 1`,
        [folderRaw, project.id],
      )
    ).rows[0];
    if (!folder) {
      return NextResponse.json(
        { ok: false, message: "Pasta de destino nao encontrada neste projeto." },
        { status: 400 },
      );
    }
    folderId = folder.id;
  }

  let items: { driveFileId: string; name: string }[] = [];
  let mirrorFolderName: string | null = null;
  if (target.kind === "file") {
    items = [
      { driveFileId: target.id, name: `Arquivo do Drive ${target.id.slice(0, 8)}` },
    ];
  } else {
    const response = await fetch(
      `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(target.id)}#grid`,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        },
        redirect: "follow",
      },
    ).catch(() => null);
    if (!response || !response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Nao foi possivel abrir a pasta. Confira se o compartilhamento esta ativo para qualquer pessoa com o link.",
        },
        { status: 400 },
      );
    }
    const html = await response.text();
    if (html.includes("ServiceLogin") || html.includes("accounts.google.com")) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Esta pasta nao esta publica. No Drive, ative o compartilhamento para qualquer pessoa com o link e tente de novo.",
        },
        { status: 400 },
      );
    }
    const parsed = parseEmbeddedFolder(html);
    const files = parsed.entries.filter((entry) => !entry.isFolder);
    if (!files.length) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Nenhum arquivo encontrado nesta pasta (ou ela nao esta publica). Ative o compartilhamento para qualquer pessoa com o link e tente de novo.",
        },
        { status: 400 },
      );
    }
    items = files
      .slice(0, MAX_FOLDER_FILES)
      .map((entry) => ({ driveFileId: entry.id, name: entry.name }));
    if (!folderId && parsed.title) mirrorFolderName = parsed.title.slice(0, 80);
  }

  if (mirrorFolderName) {
    const existing = (
      await database.pool.query<{ id: string }>(
        `select id from public.creative_folders where project_id = $1 and name = $2 limit 1`,
        [project.id, mirrorFolderName],
      )
    ).rows[0];
    if (existing) {
      folderId = existing.id;
    } else {
      const created = (
        await database.pool.query<{ id: string }>(
          `insert into public.creative_folders
             (organization_id, project_id, name, created_by_user_id)
           values ($1, $2, $3, $4) returning id`,
          [project.organization_id, project.id, mirrorFolderName, actor.id],
        )
      ).rows[0];
      folderId = created?.id ?? null;
    }
  }

  const jobId = randomUUID();
  await database.pool.query(
    `insert into public.creative_import_jobs
       (id, organization_id, project_id, folder_id, source, created_by_user_id, status)
     values ($1, $2, $3, $4, 'drive_link', $5, 'processing')`,
    [jobId, project.organization_id, project.id, folderId, actor.id],
  );
  for (const item of items) {
    await database.pool.query(
      `insert into public.creative_import_items
         (id, job_id, organization_id, project_id, source, display_name,
          drive_file_id, status)
       values ($1, $2, $3, $4, 'drive_link', $5, $6, 'pending')`,
      [randomUUID(), jobId, project.organization_id, project.id, item.name, item.driveFileId],
    );
  }
  return NextResponse.json({
    ok: true,
    jobId,
    accepted: items.length,
    folderName: mirrorFolderName,
    message:
      target.kind === "folder"
        ? `${items.length} arquivo(s) da pasta entraram na fila de importacao.`
        : "Arquivo entrou na fila de importacao.",
  });
}
