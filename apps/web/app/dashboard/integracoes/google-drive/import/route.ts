import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";
import { CREATIVE_MEDIA_POLICY_V1 } from "@funil-metrics/domain";
import { creativeImportReadiness } from "../../../../../lib/creative-import-readiness";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let input: { projectId?: string; jobId?: string };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!input.projectId || !input.jobId) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project || active.project.id !== input.projectId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const database = getDatabase();
  const client = await database.pool.connect();
  const maximumBytesByMime = Object.fromEntries(
    Object.entries(CREATIVE_MEDIA_POLICY_V1.formats).map(([mime, rule]) => [
      mime,
      rule.maxBytes,
    ]),
  );
  try {
    await client.query("begin");
    const scope = await client.query<{
      organization_id: string;
      actor_user_id: string;
      status: string;
      pending_items: number;
      pending_bytes: string;
      storage_ready: boolean;
      antimalware_ready: boolean;
    }>(
      `select job.organization_id, app_user.id as actor_user_id,
              job.status::text,
               (select count(*)::int from public.drive_import_items item
                where item.job_id = job.id and item.status = 'pending') as pending_items,
              (select coalesce(sum(coalesce(
                         file.size_bytes,
                         ($4::jsonb ->> file.mime_type)::bigint
                       )),0)::text
                 from public.drive_import_items item
                 join public.drive_files file on file.id = item.drive_file_id
                where item.job_id = job.id and item.status = 'pending') as pending_bytes,
              exists (
                select 1 from public.connections connection
                 where connection.project_id = job.project_id
                   and connection.provider = 'cloudflare_r2'
                   and connection.status = 'active'
                   and connection.configuration->>'validationStatus' = 'valid'
                   and exists (
                     select 1 from public.integration_secrets secret
                      where secret.project_id = connection.project_id
                        and secret.provider = 'cloudflare_r2'
                        and secret.kind = 'credential_bundle'
                        and secret.rotated_at is null
                   )
              ) as storage_ready,
              exists (
                select 1 from public.connections connection
                 where connection.project_id = job.project_id
                   and connection.provider = 'clamav'
                   and connection.status = 'active'
                   and connection.configuration->>'validationStatus' = 'valid'
              ) as antimalware_ready
         from public.drive_import_jobs job
         join public.users app_user on app_user.auth_user_id = $1
         join public.memberships membership
           on membership.organization_id = job.organization_id
          and membership.user_id = app_user.id
        where job.id = $2 and job.project_id = $3
          and app_user.status = 'active'
          and coalesce((select allowed.role_override
            from public.project_memberships allowed
            where allowed.membership_id=membership.id
              and allowed.project_id=job.project_id),membership.role)
              in ('owner', 'administrator')
          and (
            not exists (
              select 1 from public.project_memberships restricted
               where restricted.membership_id = membership.id
            )
            or exists (
              select 1 from public.project_memberships allowed
               where allowed.membership_id = membership.id
                 and allowed.project_id = job.project_id
                 and coalesce(allowed.role_override, membership.role)
                     in ('owner', 'administrator')
            )
          )
        for update of job
        limit 1`,
      [
        data.user.id,
        input.jobId,
        input.projectId,
        JSON.stringify(maximumBytesByMime),
      ],
    );
    const authorized = scope.rows[0];
    if (!authorized) {
      await client.query("rollback");
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (authorized.status === "importing") {
      await client.query("commit");
      return NextResponse.json({ ok: true, duplicate: true });
    }
    const readiness = creativeImportReadiness({
      storageReady: authorized.storage_ready,
      antimalwareReady: authorized.antimalware_ready,
    });
    if (!readiness.ready) {
      const reason = readiness.error!;
      await client.query(
        `insert into public.audit_logs (
           organization_id, project_id, actor_user_id, action,
           target_type, target_id, after
         ) values ($1, $2, $3, 'creative_import_blocked',
                   'drive_import_job', $4, $5::jsonb)`,
        [
          authorized.organization_id,
          input.projectId,
          authorized.actor_user_id,
          input.jobId,
          JSON.stringify({ reason }),
        ],
      );
      await client.query("commit");
      return NextResponse.json(
        { error: reason },
        { status: 409 },
      );
    }
    if (authorized.status !== "completed" || authorized.pending_items === 0) {
      await client.query("rollback");
      return NextResponse.json(
        { error: "job_not_ready_for_import" },
        { status: 409 },
      );
    }
    const executionError =
      authorized.pending_items > CREATIVE_MEDIA_POLICY_V1.execution.maxFiles
        ? "execution_file_limit_exceeded"
        : Number(authorized.pending_bytes) >
            CREATIVE_MEDIA_POLICY_V1.execution.maxBytes
          ? "execution_size_limit_exceeded"
          : null;
    if (executionError) {
      await client.query(
        `update public.drive_import_jobs
            set status = 'failed', error_code = $1,
                finished_at = now(), updated_at = now()
          where id = $2`,
        [executionError, input.jobId],
      );
      await client.query("commit");
      return NextResponse.json({ error: executionError }, { status: 409 });
    }
    await client.query(
      `update public.drive_import_jobs
          set status = 'importing', finished_at = null,
              error_code = null, updated_at = now()
        where id = $1`,
      [input.jobId],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, after
       ) values ($1, $2, $3, 'creative_import_requested',
                 'drive_import_job', $4, $5::jsonb)`,
      [
        authorized.organization_id,
        input.projectId,
        authorized.actor_user_id,
        input.jobId,
        JSON.stringify({ pendingItems: authorized.pending_items }),
      ],
    );
    await client.query("commit");
    return NextResponse.json({ ok: true });
  } catch {
    await client.query("rollback");
    return NextResponse.json(
      { error: "creative_import_request_failed" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
