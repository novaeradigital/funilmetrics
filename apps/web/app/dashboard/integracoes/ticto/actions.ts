"use server";

import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";

const scrypt = promisify(scryptCallback);
const base = "/dashboard/integracoes/ticto";
const allowedRoles = new Set(["owner", "administrator"]);
const uuidPattern = /^[0-9a-f-]{36}$/i;

// Mesmo formato do hash que a API verifica (apps/api/src/modules/ticto/token.ts).
async function hashWebhookToken(token: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(token, salt, 32)) as Buffer;
  return [
    "scrypt-v1",
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

async function authorize() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { project } = await getActiveProject(data.user.id);
  if (!project || !allowedRoles.has(project.role)) {
    redirect(`${base}?status=forbidden`);
  }
  const db = getDatabase();
  const actor = (
    await db.pool.query<{ id: string }>(
      "select id from public.users where auth_user_id=$1",
      [data.user.id],
    )
  ).rows[0]!;
  return { project, db, actor };
}

export async function createTictoConnection(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const token = String(formData.get("token") ?? "").trim();
  const businessId = String(formData.get("business_project_id") ?? "");
  if (!name || token.length < 8) redirect(`${base}?status=invalid`);
  const { project, db, actor } = await authorize();
  const tokenHash = await hashWebhookToken(token);
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    const connection = (
      await client.query<{ id: string; public_id: string }>(
        `insert into public.connections(
           organization_id, project_id, provider, name, configuration,
           business_project_id)
         values($1,$2,'ticto',$3,'{}'::jsonb,$4)
         returning id, public_id::text`,
        [
          project.organization_id,
          project.id,
          name,
          uuidPattern.test(businessId) ? businessId : null,
        ],
      )
    ).rows[0]!;
    await client.query(
      `insert into public.webhook_endpoints(connection_id, token_hash)
       values($1,$2)`,
      [connection.id, tokenHash],
    );
    await client.query(
      `insert into public.audit_logs(organization_id, project_id, actor_user_id,
         action, target_type, target_id, after)
       values($1,$2,$3,'ticto_connection_created','connection',$4,$5::jsonb)`,
      [
        project.organization_id,
        project.id,
        actor.id,
        connection.id,
        JSON.stringify({ name, publicId: connection.public_id }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect(`${base}?status=failed`);
  } finally {
    client.release();
  }
  revalidatePath(base);
  redirect(`${base}?status=created`);
}

export async function rotateTictoToken(formData: FormData) {
  const connectionId = String(formData.get("connection_id") ?? "");
  const token = String(formData.get("token") ?? "").trim();
  if (!uuidPattern.test(connectionId) || token.length < 8) {
    redirect(`${base}?status=invalid`);
  }
  const { project, db, actor } = await authorize();
  const tokenHash = await hashWebhookToken(token);
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    const updated = await client.query<{ id: string }>(
      `update public.webhook_endpoints endpoint
          set previous_token_hash = endpoint.token_hash,
              previous_token_valid_until = now() + interval '7 days',
              token_hash = $1,
              updated_at = now()
         from public.connections connection
        where endpoint.connection_id = connection.id
          and connection.id = $2
          and connection.project_id = $3
          and connection.provider = 'ticto'
        returning endpoint.id`,
      [tokenHash, connectionId, project.id],
    );
    if (!updated.rows[0]) {
      await client.query("rollback");
      redirect(`${base}?status=not-found`);
    }
    await client.query(
      `insert into public.audit_logs(organization_id, project_id, actor_user_id,
         action, target_type, target_id, after)
       values($1,$2,$3,'ticto_token_rotated','connection',$4,'{}'::jsonb)`,
      [project.organization_id, project.id, actor.id, connectionId],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect(`${base}?status=failed`);
  } finally {
    client.release();
  }
  revalidatePath(base);
  redirect(`${base}?status=updated`);
}
