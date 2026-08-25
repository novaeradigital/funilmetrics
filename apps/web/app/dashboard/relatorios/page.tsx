import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import {generateReportSnapshotNow,saveReportSchedule} from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ period?: string;status?:string }>;
};

const periods = {
  "7d": { label: "7 dias", days: 7 },
  "30d": { label: "30 dias", days: 30 },
  "90d": { label: "90 dias", days: 90 },
  all: { label: "Tudo", days: null },
} as const;

type DailyRow = {
  day: string;
  gross_revenue: string;
  net_revenue: string;
  approved_payments: number;
  reversed_payments: number;
  observed_events: number;
};

type ReportSummary = {
  days_with_activity: number;
  gross_revenue: string;
  net_revenue: string;
  approved_payments: number;
  reversed_payments: number;
};

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "30d";
  const period = periods[periodKey];
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const {project}=await getActiveProject(authData.user.id);
  if(!project)redirect("/dashboard/projetos");
  const canManage=["owner","administrator"].includes(project.role);
  const database = getDatabase();
  const result = await database.pool.query<DailyRow>(
    `with accessible_projects as (
       select project.id
         from public.projects project
         join public.users app_user on app_user.auth_user_id = $1
         join public.memberships membership
           on membership.organization_id = project.organization_id
          and membership.user_id = app_user.id
        where project.id=$3 and (not exists (
                select 1 from public.project_memberships restricted
                 where restricted.membership_id = membership.id
              )
           or exists (
                select 1 from public.project_memberships allowed
                 where allowed.membership_id = membership.id
                   and allowed.project_id = project.id
              ))
     )
     select to_char(date_trunc('day', event.occurred_at), 'YYYY-MM-DD') as day,
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
        and event.project_id in (select id from accessible_projects)
        and ($2::int is null or event.occurred_at >= now() - ($2 * interval '1 day'))
      group by date_trunc('day', event.occurred_at)
      order by date_trunc('day', event.occurred_at) desc
      limit 366`,
    [authData.user.id, period.days,project.id],
  );
  const summary: ReportSummary = result.rows.reduce(
    (total, row) => ({
      days_with_activity: total.days_with_activity + 1,
      gross_revenue: String(Number(total.gross_revenue) + Number(row.gross_revenue)),
      net_revenue: String(Number(total.net_revenue) + Number(row.net_revenue)),
      approved_payments: total.approved_payments + row.approved_payments,
      reversed_payments: total.reversed_payments + row.reversed_payments,
    }),
    {
      days_with_activity: 0,
      gross_revenue: "0",
      net_revenue: "0",
      approved_payments: 0,
      reversed_payments: 0,
    },
  );
  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: project?.currency ?? "BRL",
  });
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const schedule=(await database.pool.query<{
    frequency:string;period_days:number;enabled:boolean;last_run_at:string|null;
  }>(`select frequency::text,period_days,enabled,last_run_at::text
      from public.report_schedules where project_id=$1`,[project.id])).rows[0];
  const snapshots=(await database.pool.query<{
    id:string;created_at:string;period_days:number;snapshot:Record<string,unknown>;
  }>(`select id,created_at::text,period_days,snapshot from public.report_snapshots
      where project_id=$1 order by created_at desc limit 5`,[project.id])).rows;

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/relatorios" footerLabel="Exportação auditada" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/relatorios" statusLabel="Regra v1">
          <nav aria-label="Período do relatório" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => <a className={key === periodKey ? "period-active" : undefined} href={`/dashboard/relatorios?period=${key}`} key={key}>{option.label}</a>)}
          </nav>
          <a className="icon-button" href={`/dashboard/relatorios/export?period=${periodKey}`}>Exportar</a>
        </DashboardTopbar>
        <div className="dashboard-main">
          {params.status==="schedule-saved"?<div className="notice notice-success">Agenda salva. O relatório será gerado dentro do painel.</div>:null}
          {["schedule-invalid","schedule-forbidden"].includes(params.status??"")
            ?<div className="notice notice-error">Não foi possível alterar a agenda com este acesso.</div>:null}
          {params.status==="schedule-required"?<div className="notice notice-error">Salve uma agenda antes de gerar o fechamento.</div>:null}
          {params.status==="snapshot-failed"?<div className="notice notice-error">Não foi possível gerar o fechamento agora.</div>:null}
          <header className="dashboard-titlebar">
            <div><p className="eyebrow">Fechamento operacional</p><h1>Relatórios</h1><p className="dashboard-context">Consulte o consolidado financeiro diário e exporte uma cópia auditada.</p></div>
          </header>

          <section className="quality-summary">
            <article className="kpi-card kpi-primary"><div><span className="kpi-icon">R$</span><p>Receita bruta</p></div><strong>{money.format(Number(summary.gross_revenue))}</strong><small>{summary.approved_payments} pagamentos aprovados</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">↗</span><p>Receita líquida</p></div><strong>{money.format(Number(summary.net_revenue))}</strong><small>Após efeitos negativos</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">↩</span><p>Reversões</p></div><strong>{summary.reversed_payments}</strong><small>Pagamentos distintos revertidos</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">▤</span><p>Dias com atividade</p></div><strong>{summary.days_with_activity}</strong><small>No período selecionado</small></article>
          </section>

          <section className="dashboard-card report-card">
            <header className="card-header">
              <div><p className="panel-label">Consolidado diário</p><h2>Movimentação financeira</h2></div>
              <a className="export-button" href={`/dashboard/relatorios/export?period=${periodKey}`}>Exportar CSV ↓</a>
            </header>
            {result.rows.length ? (
              <div className="table-scroll">
                <table className="sales-table report-table">
                  <thead><tr><th>Data</th><th>Eventos observados</th><th>Aprovados</th><th>Revertidos</th><th>Receita bruta</th><th>Receita líquida</th></tr></thead>
                  <tbody>{result.rows.map((row) => (
                    <tr key={row.day}>
                      <td><strong>{date.format(new Date(`${row.day}T12:00:00Z`))}</strong></td>
                      <td>{row.observed_events}</td><td>{row.approved_payments}</td><td>{row.reversed_payments}</td>
                      <td className="money-cell">{money.format(Number(row.gross_revenue))}</td>
                      <td className="money-cell">{money.format(Number(row.net_revenue))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="chart-empty"><strong>Nenhuma movimentação encontrada</strong><p>Altere o período ou aguarde novos eventos de produção.</p></div>}
          </section>
          <section className="dashboard-card report-card">
            <header className="card-header"><div><p className="panel-label">Entrega no painel</p>
              <h2>Relatório automático</h2></div></header>
            <form action={saveReportSchedule} className="filter-card">
              <label>Frequência<select name="frequency" defaultValue={schedule?.frequency??"daily"}>
                <option value="daily">Diário</option><option value="weekly">Semanal</option>
              </select></label>
              <label>Janela<select name="period_days" defaultValue={String(schedule?.period_days??30)}>
                <option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option>
              </select></label>
              <label><input type="checkbox" name="enabled" defaultChecked={schedule?.enabled??false}/> Agenda ativa</label>
              <button type="submit">Salvar agenda</button>
            </form>
            {canManage&&schedule?<form action={generateReportSnapshotNow}><button type="submit">Gerar fechamento agora</button>
              <small>Repetições no mesmo minuto reutilizam o mesmo snapshot.</small></form>:null}
            {snapshots.length?<div className="issue-history-list">{snapshots.map(item=><div key={item.id}>
              <p><strong>Snapshot financeiro · {item.period_days} dias</strong>
                <small>{date.format(new Date(item.created_at))}</small></p>
              <span>{money.format(Number(item.snapshot.net_revenue??0))} líquido</span>
              <Link href={`/dashboard/relatorios/snapshots/${item.id}`}>Conferir fechamento</Link>
            </div>)}</div>:<div className="compact-empty">Nenhum snapshot automático gerado ainda.</div>}
            {snapshots.length?<Link className="export-button" href="/dashboard/relatorios/snapshots">Ver histórico completo</Link>:null}
          </section>
          <div className="method-note"><strong>Exportação segura</strong><p>O arquivo contém apenas valores agregados por dia, sem dados pessoais. Cada download registra usuário, projeto, período e instante na auditoria.</p></div>
        </div>
      </section>
    </main>
  );
}
