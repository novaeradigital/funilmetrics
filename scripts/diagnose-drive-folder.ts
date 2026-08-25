import pg from "pg";
import {
  getGoogleAccessToken,
  listDriveFolder,
  type InventoryCandidate,
} from "../apps/worker/src/google-drive-inventory.js";

const folderName = process.argv[2]?.trim();
if (!folderName || !process.env.DATABASE_URL) {
  throw new Error("Uso: npm run drive:folder:diagnose -- <nome-da-pasta>");
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  try {
  const result = await pool.query<InventoryCandidate>(
    `select job.id, job.organization_id, job.project_id,
            job.drive_folder_id, folder.drive_folder_id as external_folder_id,
            folder.include_subfolders, folder.drive_connection_id,
            drive.credential_secret_ref, secret.ciphertext,
            secret.initialization_vector, secret.authentication_tag
       from public.drive_folders folder
       join public.drive_connections drive on drive.id = folder.drive_connection_id
       join public.integration_secrets secret on secret.id = drive.credential_secret_ref
       join lateral (
         select import_job.id, import_job.organization_id, import_job.project_id,
                import_job.drive_folder_id
           from public.drive_import_jobs import_job
          where import_job.drive_folder_id = folder.id
          order by import_job.created_at desc limit 1
       ) job on true
      where folder.name = $1 and folder.status = 'active'
        and drive.disconnected_at is null and secret.rotated_at is null
      order by folder.authorized_at desc limit 1`,
    [folderName],
  );
  const candidate = result.rows[0];
  if (!candidate) throw new Error("drive_folder_not_found");
  const token = await getGoogleAccessToken(pool, candidate);
  const queue = [candidate.external_folder_id];
  const visited = new Set<string>();
  const mimeCounts = new Map<string, number>();
  let totalItems = 0;
  while (queue.length) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    const children = await listDriveFolder(folderId, token);
    totalItems += children.length;
    for (const child of children) {
      mimeCounts.set(child.mimeType, (mimeCounts.get(child.mimeType) ?? 0) + 1);
      if (
        candidate.include_subfolders &&
        child.mimeType === "application/vnd.google-apps.folder"
      ) {
        queue.push(child.id);
      }
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      folder: folderName,
      foldersVisited: visited.size,
      totalItems,
      mimeCounts: Object.fromEntries([...mimeCounts].sort()),
    })}\n`,
  );
  } finally {
    await pool.end();
  }
}

void main();
