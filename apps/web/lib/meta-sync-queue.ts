import "server-only";
import type { Pool } from "pg";

/**
 * Atualização ao abrir o painel (D-145): se a última sincronização da
 * Meta concluída tem mais de `staleMinutes`, enfileira uma nova para
 * cada conexão ativa do projeto. A fila tem trava anti-duplicidade
 * (nenhuma execução enfileirada se já houver uma ativa) e chave de
 * idempotência por minuto, então abrir o painel várias vezes não
 * empilha execuções nem gasta cota da Meta à toa.
 */
export async function queueMetaSyncIfStale(
  pool: Pool,
  input: {
    organizationId: string;
    projectId: string;
    authUserId: string;
    staleMinutes?: number;
  },
): Promise<number> {
  const staleMinutes = input.staleMinutes ?? 15;
  const actor = (
    await pool.query<{ id: string }>(
      `select id from public.users
        where auth_user_id=$1 and status='active' limit 1`,
      [input.authUserId],
    )
  ).rows[0];
  if (!actor) return 0;
  const connections = (
    await pool.query<{ id: string }>(
      `select connection.id
         from public.connections connection
         join public.meta_authorizations authz
           on authz.connection_id=connection.id
        where connection.project_id=$1
          and connection.organization_id=$2
          and connection.provider='meta_ads'
          and connection.status='active'
          and authz.status='active'`,
      [input.projectId, input.organizationId],
    )
  ).rows;
  let queued = 0;
  for (const connection of connections) {
    const fresh = (
      await pool.query(
        `select 1 from public.meta_sync_runs
          where connection_id=$1 and status='completed'
            and finished_at>now()-($2::text||' minutes')::interval
          limit 1`,
        [connection.id, String(staleMinutes)],
      )
    ).rows[0];
    if (fresh) continue;
    const inserted = (
      await pool.query<{ id: string }>(
        `insert into public.meta_sync_runs(
           organization_id,project_id,connection_id,idempotency_key,
           status,scheduled_for,next_attempt_at)
         select $1,$2,$3,
           'dashboard-open:'||$3::text||':'||
             to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI'),
           'queued',now(),now()
          where not exists(
            select 1 from public.meta_sync_runs active
             where active.connection_id=$3
               and active.status in ('queued','running','failed_retryable'))
         on conflict(connection_id,idempotency_key) do nothing
         returning id`,
        [input.organizationId, input.projectId, connection.id],
      )
    ).rows[0];
    if (!inserted) continue;
    queued += 1;
    await pool.query(
      `insert into public.audit_logs(
         organization_id,project_id,actor_user_id,action,target_type,
         target_id,after)
       values($1,$2,$3,'meta_sync_requested','meta_sync_run',$4,
         jsonb_build_object('connectionId',$5::text,'mode','dashboard_open'))`,
      [
        input.organizationId,
        input.projectId,
        actor.id,
        inserted.id,
        connection.id,
      ],
    );
  }
  return queued;
}
