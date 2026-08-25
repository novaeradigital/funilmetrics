import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let input: { projectId?: string; folderId?: string };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!input.projectId || !input.folderId) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project || active.project.id !== input.projectId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const database = getDatabase();
  const scope = await database.pool.query<{
    organization_id: string;
    actor_user_id: string;
  }>(
    `select folder.organization_id, app_user.id as actor_user_id
       from public.drive_folders folder
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = folder.organization_id
        and membership.user_id = app_user.id
      where folder.id = $2 and folder.project_id = $3
        and folder.status = 'active' and app_user.status = 'active'
        and coalesce((select allowed.role_override
          from public.project_memberships allowed
          where allowed.membership_id=membership.id
            and allowed.project_id=folder.project_id),membership.role)
            in ('owner', 'administrator')
        and (
          not exists (
            select 1 from public.project_memberships restricted
             where restricted.membership_id = membership.id
          )
          or exists (
            select 1 from public.project_memberships allowed
             where allowed.membership_id = membership.id
               and allowed.project_id = folder.project_id
               and coalesce(allowed.role_override, membership.role)
                   in ('owner', 'administrator')
          )
        )
      limit 1`,
    [data.user.id, input.folderId, input.projectId],
  );
  const authorized = scope.rows[0];
  if (!authorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [input.projectId, input.folderId],
    );
    const existing = await client.query<{ id: string; status: string }>(
      `select id, status::text
         from public.drive_import_jobs
        where drive_folder_id = $1
          and status in ('pending', 'inventorying', 'importing')
        order by created_at desc
        limit 1
        for update`,
      [input.folderId],
    );
    if (existing.rows[0]) {
      await client.query("commit");
      return NextResponse.json({
        ok: true,
        duplicate: true,
        jobId: existing.rows[0].id,
        status: existing.rows[0].status,
      });
    }
    const job = await client.query<{ id: string }>(
      `insert into public.drive_import_jobs (
         organization_id, project_id, drive_folder_id,
         requested_by_user_id, idempotency_key
       ) values ($1, $2, $3, $4, $5)
       returning id`,
      [
        authorized.organization_id,
        input.projectId,
        input.folderId,
        authorized.actor_user_id,
        `manual-inventory:${randomUUID()}`,
      ],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, after
       ) values ($1, $2, $3, 'drive_inventory_requested',
                 'drive_import_job', $4, $5::jsonb)`,
      [
        authorized.organization_id,
        input.projectId,
        authorized.actor_user_id,
        job.rows[0]!.id,
        JSON.stringify({ folderId: input.folderId, mode: "manual" }),
      ],
    );
    await client.query("commit");
    return NextResponse.json({ ok: true, jobId: job.rows[0]!.id });
  } catch {
    await client.query("rollback");
    return NextResponse.json(
      { error: "inventory_request_failed" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
