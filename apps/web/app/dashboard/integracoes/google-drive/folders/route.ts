import { NextRequest, NextResponse } from "next/server";
import {
  exchangeGoogleRefreshToken,
  getAuthorizedDriveConnection,
} from "../../../../../lib/google-drive-access";
import { getDatabase } from "../../../../../lib/database";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

const folderMimeType = "application/vnd.google-apps.folder";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let input: {
    projectId?: string;
    folderId?: string;
    includeSubfolders?: boolean;
  };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!input.projectId || !input.folderId || input.folderId.length > 256) {
    return NextResponse.json({ error: "invalid_folder" }, { status: 400 });
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project || active.project.id !== input.projectId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const authorized = await getAuthorizedDriveConnection({
      authUserId: data.user.id,
      projectId: input.projectId,
    });
    if (!authorized) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const token = await exchangeGoogleRefreshToken(
      authorized.config,
      authorized.refreshToken,
    );
    const metadataUrl = new URL(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.folderId)}`,
    );
    metadataUrl.searchParams.set(
      "fields",
      "id,name,mimeType,parents,trashed,driveId",
    );
    metadataUrl.searchParams.set("supportsAllDrives", "true");
    const metadataResponse = await fetch(metadataUrl, {
      headers: { authorization: `Bearer ${token.accessToken}` },
      cache: "no-store",
    });
    if (!metadataResponse.ok) {
      return NextResponse.json(
        { error: "folder_not_accessible" },
        { status: 422 },
      );
    }
    const folder = (await metadataResponse.json()) as {
      id?: string;
      name?: string;
      mimeType?: string;
      trashed?: boolean;
      driveId?: string;
    };
    if (
      folder.id !== input.folderId ||
      folder.mimeType !== folderMimeType ||
      folder.trashed ||
      !folder.name
    ) {
      return NextResponse.json(
        { error: "selection_is_not_active_folder" },
        { status: 422 },
      );
    }

    const database = getDatabase();
    const client = await database.pool.connect();
    try {
      await client.query("begin");
      const saved = await client.query<{ id: string }>(
        `insert into public.drive_folders (
           organization_id, project_id, drive_connection_id, drive_folder_id,
           name, known_path, include_subfolders, authorized_by_user_id
         ) values ($1, $2, $3, $4, $5, $5, $6, $7)
         on conflict (drive_connection_id, drive_folder_id)
         do update set name = excluded.name,
                       status = 'active',
                       include_subfolders = excluded.include_subfolders,
                       authorized_by_user_id = excluded.authorized_by_user_id,
                       authorized_at = now(),
                       updated_at = now()
         returning id`,
        [
          authorized.connection.organizationId,
          authorized.connection.projectId,
          authorized.connection.driveConnectionId,
          folder.id,
          folder.name,
          input.includeSubfolders !== false,
          authorized.connection.actorUserId,
        ],
      );
      await client.query(
        `insert into public.audit_logs (
           organization_id, project_id, actor_user_id, action,
           target_type, target_id, after
         ) values ($1, $2, $3, 'drive_folder_connected',
                   'drive_folder', $4, $5::jsonb)`,
        [
          authorized.connection.organizationId,
          authorized.connection.projectId,
          authorized.connection.actorUserId,
          saved.rows[0]!.id,
          JSON.stringify({
            folderId: folder.id,
            folderName: folder.name,
            sharedDrive: Boolean(folder.driveId),
            includeSubfolders: input.includeSubfolders !== false,
          }),
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return NextResponse.json({ ok: true, name: folder.name });
  } catch {
    return NextResponse.json(
      { error: "folder_connection_failed" },
      { status: 502 },
    );
  }
}
