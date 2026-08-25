import { randomUUID } from "node:crypto";
import { getDatabase } from "../../../../lib/database";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";

const periods = { "7d": 7, "30d": 30, "90d": 90, all: null } as const;

type ExportRow = {
  day: string;
  gross_revenue: string;
  net_revenue: string;
  approved_payments: number;
  reversed_payments: number;
  observed_events: number;
};

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return new Response("Não autorizado", { status: 401 });
  const active=await getActiveProject(authData.user.id);
  if(!active.project)return new Response("Projeto não disponível",{status:403});

  const requestedPeriod = new URL(request.url).searchParams.get("period") ?? "30d";
  const periodKey =
    requestedPeriod in periods ? (requestedPeriod as keyof typeof periods) : "30d";
  const database = getDatabase();
  const client = await database.pool.connect();

  try {
    await client.query("begin");
    const scopeResult = await client.query<{
      internal_user_id: string;
      organization_id: string;
      project_id: string;
      currency: string;
    }>(
      `select app_user.id as internal_user_id, project.organization_id,
              project.id as project_id, project.currency
         from public.projects project
         join public.users app_user on app_user.auth_user_id = $1
         join public.memberships membership
           on membership.organization_id = project.organization_id
          and membership.user_id = app_user.id
        where project.id=$2 and (not exists (
                select 1 from public.project_memberships restricted
                 where restricted.membership_id = membership.id
              )
           or exists (
                select 1 from public.project_memberships allowed
                 where allowed.membership_id = membership.id
                   and allowed.project_id = project.id
              ))
        order by project.created_at limit 1`,
      [authData.user.id,active.project.id],
    );
    const scope = scopeResult.rows[0];
    if (!scope) {
      await client.query("rollback");
      return new Response("Projeto não disponível", { status: 403 });
    }

    const reportResult = await client.query<ExportRow>(
      `select to_char(date_trunc('day', event.occurred_at), 'YYYY-MM-DD') as day,
              coalesce(sum(event.financial_effect)
                filter (where event.financial_effect > 0), 0)::text as gross_revenue,
              coalesce(sum(event.financial_effect), 0)::text as net_revenue,
              count(distinct event.payment_id)
                filter (where event.financial_effect > 0)::int as approved_payments,
              count(distinct event.payment_id)
                filter (where event.financial_effect < 0)::int as reversed_payments,
              count(*)::int as observed_events
         from public.normalized_payment_events event
        where event.data_scope = 'production'
          and event.project_id = $1
          and ($2::int is null or event.occurred_at >= now() - ($2 * interval '1 day'))
        group by date_trunc('day', event.occurred_at)
        order by date_trunc('day', event.occurred_at) desc
        limit 366`,
      [scope.project_id, periods[periodKey]],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action, target_type,
         target_id, reason, metadata, request_id
       ) values ($1, $2, $3, 'financial_report_exported', 'report',
                 'daily_financial_v1', 'Exportação solicitada pelo usuário',
                 $4::jsonb, $5)`,
      [
        scope.organization_id,
        scope.project_id,
        scope.internal_user_id,
        JSON.stringify({
          format: "csv",
          period: periodKey,
          rows: reportResult.rows.length,
          dataScope: "production",
          ruleVersion: "financial_v1",
        }),
        randomUUID(),
      ],
    );
    await client.query("commit");

    const rows: Array<Array<string | number>> = [
      ["data", "moeda", "eventos_observados", "pagamentos_aprovados",
        "pagamentos_revertidos", "receita_bruta", "receita_liquida"],
      ...reportResult.rows.map((row) => [
        row.day, scope.currency, row.observed_events, row.approved_payments,
        row.reversed_payments, row.gross_revenue, row.net_revenue,
      ]),
    ];
    const csv = `\uFEFF${rows
      .map((row) => row.map(csvCell).join(";"))
      .join("\r\n")}`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="funil-metrics-financeiro-${periodKey}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    await client.query("rollback");
    console.error("financial_report_export_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return new Response("Não foi possível gerar o relatório", { status: 500 });
  } finally {
    client.release();
  }
}
