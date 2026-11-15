"use server";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../../lib/database";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";

const scrypt = promisify(scryptCallback);

async function hashToken(token: string) {
  const salt = randomBytes(16);
  const key = (await scrypt(token, salt, 32)) as Buffer;
  return `scrypt-v1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyToken(token: string, storedHash: string) {
  const [version, saltText, hashText] = storedHash.split("$");
  if (version !== "scrypt-v1" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(
    token,
    Buffer.from(saltText, "base64url"),
    expected.length,
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function requireAdministrator(connectionId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const database = getDatabase();
  const result = await database.pool.query<{
    organization_id: string;
    project_id: string;
    internal_user_id: string;
    connection_id: string | null;
    token_hash: string | null;
    status: string | null;
  }>(
    `select p.organization_id, p.id as project_id,
            u.id as internal_user_id, c.id as connection_id,
            endpoint.token_hash, c.status
       from public.projects p
       join public.users u on u.auth_user_id = $2
       join public.memberships m
         on m.organization_id = p.organization_id
        and m.user_id = u.id
       left join public.connections c
         on c.project_id = p.id
        and c.organization_id = p.organization_id
        and c.provider = 'chatsx'
        and ($1::uuid is null or c.id = $1)
       left join public.webhook_endpoints endpoint
         on endpoint.connection_id = c.id
      where ($1::uuid is null or c.id = $1)
        and coalesce((select allowed.role_override
          from public.project_memberships allowed
          where allowed.membership_id=m.id and allowed.project_id=p.id),
          m.role) in ('owner', 'administrator')
        and (
          not exists (
            select 1 from public.project_memberships restricted
             where restricted.membership_id = m.id
          )
          or exists (
            select 1 from public.project_memberships allowed
             where allowed.membership_id = m.id
               and allowed.project_id = p.id
               and coalesce(allowed.role_override, m.role)
                   in ('owner', 'administrator')
          )
        )
      limit 1`,
    [connectionId || null, data.user.id],
  );
  if (!result.rowCount) {
    redirect("/dashboard/integracoes/chatsx?status=forbidden");
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project || active.project.id !== result.rows[0]!.project_id) {
    redirect("/dashboard/integracoes/chatsx?status=forbidden");
  }
  return { database, actor: result.rows[0]! };
}

export async function createChatsxConnection(formData: FormData) {
  const projectId = text(formData, "projectId");
  const label = text(formData, "label");
  const token = text(formData, "token");

  if (
    !/^[0-9a-f-]{36}$/i.test(projectId) ||
    label.length < 3 ||
    token.length < 12
  ) {
    redirect(
      "/dashboard/integracoes/chatsx?status=invalid",
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirect("/login");
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project || active.project.id !== projectId) {
    redirect("/dashboard/integracoes/chatsx?status=forbidden");
  }

  const database = getDatabase();
  const authorization = await database.pool.query<{
    organization_id: string;
    internal_user_id: string;
  }>(
    `select p.organization_id, u.id as internal_user_id
       from public.projects p
       join public.users u on u.auth_user_id = $2
       join public.memberships m
         on m.organization_id = p.organization_id
        and m.user_id = u.id
      where p.id = $1
        and coalesce((select allowed.role_override
          from public.project_memberships allowed
          where allowed.membership_id=m.id and allowed.project_id=p.id),
          m.role) in ('owner', 'administrator')
        and (
          not exists (
            select 1
              from public.project_memberships restricted
             where restricted.membership_id = m.id
          )
          or exists (
            select 1
              from public.project_memberships allowed
             where allowed.membership_id = m.id
               and allowed.project_id = p.id
               and coalesce(allowed.role_override, m.role)
                   in ('owner', 'administrator')
          )
        )
      limit 1`,
    [projectId, data.user.id],
  );

  if (!authorization.rowCount) {
    redirect("/dashboard/integracoes/chatsx?status=forbidden");
  }

  const tokenHash = await hashToken(token);
  const actor = authorization.rows[0]!;
  const client = await database.pool.connect();
  let publicId = "";
  try {
    await client.query("begin");
    const connection = await client.query<{
      id: string;
      public_id: string;
    }>(
      `insert into public.connections (
         organization_id, project_id, provider, name, configuration
       )
       values ($1, $2, 'chatsx', $3, $4::jsonb)
       returning id, public_id`,
      [
        actor.organization_id,
        projectId,
        label,
        JSON.stringify({}),
      ],
    );
    const created = connection.rows[0]!;
    publicId = created.public_id;

    await client.query(
      `insert into public.webhook_endpoints (connection_id, token_hash)
       values ($1, $2)`,
      [created.id, tokenHash],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, after
       )
       values ($1, $2, $3, 'chatsx_connection_created',
               'connection', $4, $5::jsonb)`,
      [
        actor.organization_id,
        projectId,
        actor.internal_user_id,
        created.id,
        JSON.stringify({
          label,
          tokenStoredAsHash: true,
        }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect("/dashboard/integracoes/chatsx?status=error");
  } finally {
    client.release();
  }

  revalidatePath("/dashboard/integracoes/chatsx");
  redirect(
    `/dashboard/integracoes/chatsx?status=created&publicId=${encodeURIComponent(publicId)}`,
  );
}

export async function testChatsxToken(formData: FormData) {
  const connectionId = text(formData, "connectionId");
  const token = text(formData, "token");
  if (!/^[0-9a-f-]{36}$/i.test(connectionId) || token.length < 12) {
    redirect("/dashboard/integracoes/chatsx?status=invalid");
  }

  const { database, actor } = await requireAdministrator(connectionId);
  const valid =
    actor.status === "active" &&
    !!actor.token_hash &&
    (await verifyToken(token, actor.token_hash));

  await database.pool.query(
    `insert into public.audit_logs (
       organization_id, project_id, actor_user_id, action,
       target_type, target_id, metadata
     )
     values ($1, $2, $3, 'chatsx_token_tested',
             'connection', $4, $5::jsonb)`,
    [
      actor.organization_id,
      actor.project_id,
      actor.internal_user_id,
      connectionId,
      JSON.stringify({ valid }),
    ],
  );

  redirect(
    `/dashboard/integracoes/chatsx?status=${valid ? "token-valid" : "token-invalid"}`,
  );
}

export async function rotateChatsxToken(formData: FormData) {
  const connectionId = text(formData, "connectionId");
  const token = text(formData, "token");
  if (!/^[0-9a-f-]{36}$/i.test(connectionId) || token.length < 12) {
    redirect("/dashboard/integracoes/chatsx?status=invalid");
  }

  const { database, actor } = await requireAdministrator(connectionId);
  if (!actor.connection_id || !actor.token_hash) {
    redirect("/dashboard/integracoes/chatsx?status=error");
  }
  const newHash = await hashToken(token);
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update public.webhook_endpoints
          set previous_token_hash = token_hash,
              previous_token_valid_until = $2,
              token_hash = $3,
              updated_at = now()
        where connection_id = $1`,
      [connectionId, validUntil, newHash],
    );
    await client.query(
      `update public.connections
          set status = 'active', updated_at = now()
        where id = $1`,
      [connectionId],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, metadata
       )
       values ($1, $2, $3, 'chatsx_token_rotated',
               'connection', $4, $5::jsonb)`,
      [
        actor.organization_id,
        actor.project_id,
        actor.internal_user_id,
        connectionId,
        JSON.stringify({ previousTokenValidUntil: validUntil.toISOString() }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect("/dashboard/integracoes/chatsx?status=error");
  } finally {
    client.release();
  }

  revalidatePath("/dashboard/integracoes/chatsx");
  redirect("/dashboard/integracoes/chatsx?status=rotated");
}

export async function revokeChatsxConnection(formData: FormData) {
  const connectionId = text(formData, "connectionId");
  const confirmation = text(formData, "confirmation");
  if (
    !/^[0-9a-f-]{36}$/i.test(connectionId) ||
    confirmation !== "REVOGAR"
  ) {
    redirect("/dashboard/integracoes/chatsx?status=confirmation-required");
  }

  const { database, actor } = await requireAdministrator(connectionId);
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update public.connections
          set status = 'revoked', updated_at = now()
        where id = $1`,
      [connectionId],
    );
    await client.query(
      `update public.webhook_endpoints
          set previous_token_hash = null,
              previous_token_valid_until = null,
              updated_at = now()
        where connection_id = $1`,
      [connectionId],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, before, after
       )
       values ($1, $2, $3, 'chatsx_connection_revoked',
               'connection', $4, $5::jsonb, $6::jsonb)`,
      [
        actor.organization_id,
        actor.project_id,
        actor.internal_user_id,
        connectionId,
        JSON.stringify({ status: actor.status }),
        JSON.stringify({ status: "revoked" }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect("/dashboard/integracoes/chatsx?status=error");
  } finally {
    client.release();
  }

  revalidatePath("/dashboard/integracoes/chatsx");
  redirect("/dashboard/integracoes/chatsx?status=revoked");
}
