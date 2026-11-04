import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { CREATIVE_MEDIA_POLICY_V1 } from "@funil-metrics/domain";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import {
  createR2PreviewClient,
  loadProjectR2PreviewConfig,
} from "../../../../lib/r2-preview";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

// Limite pratico do envio direto pelo navegador. Arquivos maiores entram
// pelo link do Drive ou pela sincronizacao de pastas.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const extensionMime: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
};

type Rejected = { name: string; reason: string };

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
      { ok: false, message: "Seu papel nao permite enviar criativos neste projeto." },
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
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { ok: false, message: "Envio invalido. Tente de novo." },
      { status: 400 },
    );
  }
  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size >= 0);
  if (!files.length) {
    return NextResponse.json(
      { ok: false, message: "Escolha pelo menos um arquivo." },
      { status: 400 },
    );
  }
  if (files.length > 50) {
    return NextResponse.json(
      { ok: false, message: "Envie no maximo 50 arquivos por vez." },
      { status: 400 },
    );
  }
  let folderId: string | null = null;
  const folderRaw = String(form.get("folder_id") ?? "").trim();
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
  let config;
  try {
    config = await loadProjectR2PreviewConfig(database.pool, project.id);
  } catch {
    config = null;
  }
  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "O armazenamento (R2) nao esta configurado neste projeto. Configure em Integracoes antes de enviar.",
      },
      { status: 400 },
    );
  }
  const client = createR2PreviewClient(config);
  const jobId = randomUUID();
  await database.pool.query(
    `insert into public.creative_import_jobs
       (id, organization_id, project_id, folder_id, source, created_by_user_id, status)
     values ($1, $2, $3, $4, 'upload', $5, 'processing')`,
    [jobId, project.organization_id, project.id, folderId, actor.id],
  );
  const rejected: Rejected[] = [];
  let accepted = 0;
  for (const file of files) {
    const name = file.name.slice(0, 240) || "arquivo";
    const extension = name.includes(".")
      ? name.split(".").pop()!.toLowerCase()
      : "";
    const mimeType = file.type || extensionMime[extension] || "";
    const format =
      mimeType in CREATIVE_MEDIA_POLICY_V1.formats
        ? CREATIVE_MEDIA_POLICY_V1.formats[
            mimeType as keyof typeof CREATIVE_MEDIA_POLICY_V1.formats
          ]
        : null;
    if (!format || "export" in format) {
      rejected.push({
        name,
        reason: "formato nao suportado (envie video MP4, MOV ou WebM, imagem, PDF ou texto)",
      });
      continue;
    }
    if (file.size === 0) {
      rejected.push({ name, reason: "arquivo vazio" });
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      rejected.push({
        name,
        reason: "acima de 200 MB no envio direto; use o link do Drive",
      });
      continue;
    }
    if (file.size > format.maxBytes) {
      rejected.push({ name, reason: "acima do limite permitido para o formato" });
      continue;
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const itemId = randomUUID();
      const key = [
        "quarantine",
        project.organization_id,
        project.id,
        jobId,
        itemId,
      ].join("/");
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: buffer,
          ContentType: format.outputMime,
          ContentLength: buffer.length,
          Metadata: {
            organization_id: project.organization_id,
            project_id: project.id,
            import_job_id: jobId,
            import_item_id: itemId,
            availability: "quarantined",
          },
        }),
      );
      await database.pool.query(
        `insert into public.creative_import_items
           (id, job_id, organization_id, project_id, source, display_name,
            mime_type, size_bytes, staging_key, content_sha256, status)
         values ($1, $2, $3, $4, 'upload', $5, $6, $7, $8, $9, 'pending')`,
        [
          itemId,
          jobId,
          project.organization_id,
          project.id,
          name,
          format.outputMime,
          buffer.length,
          key,
          sha256,
        ],
      );
      accepted += 1;
    } catch {
      rejected.push({ name, reason: "falha ao enviar o arquivo; tente de novo" });
    }
  }
  if (!accepted) {
    await database.pool.query(
      `delete from public.creative_import_jobs where id = $1`,
      [jobId],
    );
    return NextResponse.json(
      {
        ok: false,
        message: "Nenhum arquivo foi aceito.",
        rejected,
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, jobId, accepted, rejected });
}
