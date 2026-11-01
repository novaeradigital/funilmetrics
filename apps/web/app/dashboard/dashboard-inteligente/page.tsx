import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { queueMetaSyncIfStale, queueQuickMetaSync } from "../../../lib/meta-sync-queue";
import {
  computeDerived,
  dddToUf,
  deltaPercent,
  extractAdId,
} from "../../../lib/dashboard-inteligente";
import { BrazilMap, type RegionDatum } from "./brazil-map";
import { UF_NAMES } from "./brazil-map-data";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ period?: string }> };

const periods = {
  "7d": { label: "7 dias", description: "Últimos 7 dias", days: 7 },
  "30d": { label: "30 dias", description: "Últimos 30 dias", days: 30 },
  "90d": { label: "90 dias", description: "Últimos 90 dias", days: 90 },
  all: { label: "Tudo", description: "Todo o histórico", days: null },
} as const;

type PeriodKey = keyof typeof periods;

const ACCESSIBLE_PROJECTS = `
  with accessible_projects as (
    select project.id
      from public.projects project
      join public.users app_user on app_user.auth_user_id = $1
      join public.memberships membership
        on membership.organization_id = project.organization_id
       and membership.user_id = app_user.id
     where project.id = $3 and (not exists (
             select 1 from public.project_memberships restricted
              where restricted.membership_id = membership.id)
        or exists (
             select 1 from public.project_memberships allowed
              where allowed.membership_id = membership.id
                and allowed.project_id = project.id))
  )`;

type SalesKpis = { rev_cur: string; rev_prev: string; sales_cur: number; sales_prev: number };
type SpendRow = { currency: string; spend_cur: string; spend_prev: string; last_date: string | null };
type DailyRevenue = { day: string; revenue: string };
type DailySpend = { day: string; spend: string };
type UtmSales = { utm_content: string | null; sales: number; revenue: string };
type AdSpend = {
  external_ad_id: string;
  spend: string;
  impressions: string;
  link_clicks: string;
};
type AdName = { external_id: string; name: string; campaign_name: string | null };
type PhoneSales = { phone: string | null; sales: number; revenue: string };
type RecentSale = {
  occurred_at: string;
  amount: string;
  product_name: string | null;
  phone: string | null;
};

function formatDelta(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const sign = value > 0 ? "▲" : value < 0 ? "▼" : "•";
  return `${sign} ${Math.abs(value).toFixed(1).replace(".", ",")}% vs. período anterior`;
}

function DeltaLine({ value, invert = false }: { value: number | null; invert?: boolean }) {
  const text = formatDelta(value);
  if (!text) return <small>Sem base de comparação</small>;
  const good = invert ? value! < 0 : value! > 0;
  const bad = invert ? value! > 0 : value! < 0;
  return (
    <small className={good ? "di-delta-up" : bad ? "di-delta-down" : undefined}>{text}</small>
  );
}

function CrossChart({
  rows,
  money,
}: {
  rows: { day: string; revenue: number; spend: number }[];
  money: Intl.NumberFormat;
}) {
  const hasData = rows.some((row) => row.revenue > 0 || row.spend > 0);
  if (!hasData) {
    return (
      <div className="chart-empty">
        <span className="chart-empty-icon" aria-hidden="true">↗</span>
        <strong>Sem faturamento ou gasto neste período</strong>
        <p>Quando houver vendas da Lastlink e insights da Meta, as duas séries aparecem aqui.</p>
      </div>
    );
  }

  const width = 720;
  const height = 240;
  const padTop = 16;
  const padBottom = 24;
  const max = Math.max(...rows.flatMap((row) => [row.revenue, row.spend]), 1);
  const x = (index: number) =>
    rows.length <= 1 ? width / 2 : (index / (rows.length - 1)) * (width - 16) + 8;
  const y = (value: number) =>
    padTop + (1 - value / max) * (height - padTop - padBottom);
  const line = (key: "revenue" | "spend") =>
    rows.map((row, index) => `${x(index)},${y(row[key])}`).join(" ");
  const formatDay = (day: string) =>
    new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })
      .format(new Date(`${day}T12:00:00Z`))
      .replace(".", "");
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];

  return (
    <div className="di-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Faturamento versus gasto por dia">
        <polyline className="di-chart-revenue" points={line("revenue")} fill="none" />
        <polyline className="di-chart-spend" points={line("spend")} fill="none" />
      </svg>
      <div className="di-chart-axis">
        <span>{firstRow ? formatDay(firstRow.day) : ""}</span>
        <span>Máx. {money.format(max)}</span>
        <span>{lastRow ? formatDay(lastRow.day) : ""}</span>
      </div>
    </div>
  );
}

export default async function DashboardInteligentePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const periodKey: PeriodKey =
    params.period && params.period in periods ? (params.period as PeriodKey) : "30d";
  const period = periods[periodKey];

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const active = await getActiveProject(authData.user.id);
  if (!active.project) redirect("/dashboard/projetos");

  const project = active.project;
  const database = getDatabase();
  after(async () => { await queueMetaSyncIfStale(database.pool, { organizationId: project.organization_id, projectId: project.id, authUserId: authData.user.id }).catch(() => 0); await queueQuickMetaSync(database.pool, { organizationId: project.organization_id, projectId: project.id, authUserId: authData.user.id }).catch(() => []); });
  const userId = authData.user.id;
  const days = period.days;

  let content: ReactNode;
  try {
    const salesKpis = (
      await database.pool.query<SalesKpis>(
        `${ACCESSIBLE_PROJECTS}
         select
           coalesce(sum(event.financial_effect) filter (
             where event.financial_effect > 0
               and ($2::int is null or event.occurred_at >= now() - ($2::int * interval '1 day'))), 0)::text as rev_cur,
           coalesce(sum(event.financial_effect) filter (
             where event.financial_effect > 0
               and $2::int is not null
               and event.occurred_at >= now() - ((2 * $2::int) * interval '1 day')
               and event.occurred_at < now() - ($2::int * interval '1 day')), 0)::text as rev_prev,
           (count(distinct event.payment_id) filter (
             where event.financial_effect > 0
               and ($2::int is null or event.occurred_at >= now() - ($2::int * interval '1 day'))))::int as sales_cur,
           (count(distinct event.payment_id) filter (
             where event.financial_effect > 0
               and $2::int is not null
               and event.occurred_at >= now() - ((2 * $2::int) * interval '1 day')
               and event.occurred_at < now() - ($2::int * interval '1 day')))::int as sales_prev
           from public.normalized_payment_events event
          where event.data_scope = 'production'
            and event.project_id in (select id from accessible_projects)
            and ($2::int is null or event.occurred_at >= now() - ((2 * $2::int) * interval '1 day'))`,
        [userId, days, project.id],
      )
    ).rows[0] ?? { rev_cur: "0", rev_prev: "0", sales_cur: 0, sales_prev: 0 };

    const spendRows = (
      await database.pool.query<SpendRow>(
        `select coalesce(currency, 'BRL') as currency,
           coalesce(sum(spend) filter (
             where $2::int is null or metric_date >= current_date - ($2::int - 1)), 0)::text as spend_cur,
           coalesce(sum(spend) filter (
             where $2::int is not null
               and metric_date >= current_date - (2 * $2::int - 1)
               and metric_date < current_date - ($2::int - 1)), 0)::text as spend_prev,
           max(metric_date)::text as last_date
           from public.meta_ad_insights_daily
          where project_id = $1
          group by coalesce(currency, 'BRL')
          order by spend_cur desc`,
        [project.id, days],
      )
    ).rows;
    const spendRow =
      spendRows.find((row) => row.currency === project.currency) ?? spendRows[0] ?? null;

    const dailyRevenue = (
      await database.pool.query<DailyRevenue>(
        `${ACCESSIBLE_PROJECTS}
         select (event.occurred_at at time zone $4)::date::text as day,
           coalesce(sum(event.financial_effect) filter (where event.financial_effect > 0), 0)::text as revenue
           from public.normalized_payment_events event
          where event.data_scope = 'production'
            and event.project_id in (select id from accessible_projects)
            and ($2::int is null or event.occurred_at >= now() - ($2::int * interval '1 day'))
          group by 1 order by 1`,
        [userId, days, project.id, project.timezone],
      )
    ).rows;

    const dailySpend = (
      await database.pool.query<DailySpend>(
        `select metric_date::text as day, sum(spend)::text as spend
           from public.meta_ad_insights_daily
          where project_id = $1
            and ($2::int is null or metric_date >= current_date - ($2::int - 1))
          group by 1 order by 1`,
        [project.id, days],
      )
    ).rows;

    const utmSales = (
      await database.pool.query<UtmSales>(
        `${ACCESSIBLE_PROJECTS},
         first_attr as (
           select distinct on (attr.order_id) attr.order_id, attr.utm_content
             from public.order_attributions attr
            where attr.project_id in (select id from accessible_projects)
            order by attr.order_id, attr.created_at asc
         )
         select first_attr.utm_content as utm_content,
           count(distinct event.payment_id)::int as sales,
           coalesce(sum(event.financial_effect) filter (where event.financial_effect > 0), 0)::text as revenue
           from public.normalized_payment_events event
           left join first_attr on first_attr.order_id = event.order_id
          where event.data_scope = 'production'
            and event.project_id in (select id from accessible_projects)
            and event.financial_effect > 0
            and ($2::int is null or event.occurred_at >= now() - ($2::int * interval '1 day'))
          group by first_attr.utm_content`,
        [userId, days, project.id],
      )
    ).rows;

    const adSpend = (
      await database.pool.query<AdSpend>(
        `select external_ad_id,
           sum(spend)::text as spend,
           sum(impressions)::text as impressions,
           sum(coalesce((
             select sum((elem ->> 'value')::numeric)
               from jsonb_array_elements(case when jsonb_typeof(actions) = 'array' then actions else '[]'::jsonb end) elem
              where elem ->> 'action_type' = 'link_click'), 0))::text as link_clicks
           from public.meta_ad_insights_daily
          where project_id = $1
            and ($2::int is null or metric_date >= current_date - ($2::int - 1))
          group by external_ad_id`,
        [project.id, days],
      )
    ).rows;

    const adNames = (
      await database.pool.query<AdName>(
        `select ad.external_id, ad.name, campaign.name as campaign_name
           from public.meta_ads ad
           left join public.meta_campaigns campaign on campaign.id = ad.meta_campaign_id
          where ad.project_id = $1`,
        [project.id],
      )
    ).rows;

    const phoneSales = (
      await database.pool.query<PhoneSales>(
        `${ACCESSIBLE_PROJECTS}
         select phone.normalized_value as phone,
           count(distinct event.payment_id)::int as sales,
           coalesce(sum(event.financial_effect), 0)::text as revenue
           from public.normalized_payment_events event
           join public.commerce_orders ord on ord.id = event.order_id
           left join lateral (
             select ident.normalized_value
               from public.person_identifiers ident
              where ident.person_id = ord.person_id
                and ident.project_id = ord.project_id
                and ident.type = 'phone'
              order by ident.created_at asc
              limit 1
           ) phone on true
          where event.data_scope = 'production'
            and event.project_id in (select id from accessible_projects)
            and event.financial_effect > 0
            and ($2::int is null or event.occurred_at >= now() - ($2::int * interval '1 day'))
          group by phone.normalized_value`,
        [userId, days, project.id],
      )
    ).rows;

    const recentSales = (
      await database.pool.query<RecentSale>(
        `${ACCESSIBLE_PROJECTS}
         select event.occurred_at::text as occurred_at,
           event.financial_effect::text as amount,
           (select product.name
              from public.commerce_order_items item
              join public.commerce_products product on product.id = item.product_id
             where item.order_id = ord.id
             order by product.name
             limit 1) as product_name,
           phone.normalized_value as phone
           from public.normalized_payment_events event
           join public.commerce_orders ord on ord.id = event.order_id
           left join lateral (
             select ident.normalized_value
               from public.person_identifiers ident
              where ident.person_id = ord.person_id
                and ident.project_id = ord.project_id
                and ident.type = 'phone'
              order by ident.created_at asc
              limit 1
           ) phone on true
          where event.data_scope = 'production'
            and event.project_id in (select id from accessible_projects)
            and event.financial_effect > 0
            and event.occurred_at >= now() - ($2::int * interval '1 day')
          order by event.occurred_at desc
          limit 12`,
        [userId, 90, project.id],
      )
    ).rows;

    const money = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: project.currency,
    });
    // O gasto fica na moeda da conta de anúncios (pode diferir da moeda do projeto).
    const moneySpend = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: spendRow?.currency ?? project.currency,
    });
    const number = new Intl.NumberFormat("pt-BR");

    const revenue = Number(salesKpis.rev_cur);
    const revenuePrev = days === null ? revenue : Number(salesKpis.rev_prev);
    const sales = salesKpis.sales_cur;
    const salesPrev = days === null ? sales : salesKpis.sales_prev;
    const spend = spendRow ? Number(spendRow.spend_cur) : 0;
    const spendPrev = days === null ? spend : spendRow ? Number(spendRow.spend_prev) : 0;
    const hasMetaData = spendRow !== null && spendRow.last_date !== null;

    const derived = computeDerived({ revenue, spend, sales });
    const derivedPrev = computeDerived({
      revenue: revenuePrev,
      spend: spendPrev,
      sales: salesPrev,
    });

    // Série diária combinada (faturamento × gasto)
    const byDay = new Map<string, { revenue: number; spend: number }>();
    for (const row of dailyRevenue) byDay.set(row.day, { revenue: Number(row.revenue), spend: 0 });
    for (const row of dailySpend) {
      const current = byDay.get(row.day) ?? { revenue: 0, spend: 0 };
      current.spend += Number(row.spend);
      byDay.set(row.day, current);
    }
    const dailyRows = [...byDay.entries()]
      .map(([day, values]) => ({ day, ...values }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-90);

    // Vendas por anúncio (a partir do utm_content) × gasto por anúncio
    const salesByAd = new Map<string, { sales: number; revenue: number }>();
    const organic = { sales: 0, revenue: 0 };
    for (const row of utmSales) {
      const adId = extractAdId(row.utm_content);
      if (!adId) {
        organic.sales += row.sales;
        organic.revenue += Number(row.revenue);
        continue;
      }
      const current = salesByAd.get(adId) ?? { sales: 0, revenue: 0 };
      current.sales += row.sales;
      current.revenue += Number(row.revenue);
      salesByAd.set(adId, current);
    }
    const spendByAd = new Map(adSpend.map((row) => [row.external_ad_id, row]));
    const nameByAd = new Map(adNames.map((row) => [row.external_id, row]));
    const adIds = new Set([...salesByAd.keys(), ...spendByAd.keys()]);
    const adRows = [...adIds]
      .map((adId) => {
        const sale = salesByAd.get(adId) ?? { sales: 0, revenue: 0 };
        const spendItem = spendByAd.get(adId);
        const adSpendValue = spendItem ? Number(spendItem.spend) : 0;
        const impressions = spendItem ? Number(spendItem.impressions) : 0;
        const linkClicks = spendItem ? Number(spendItem.link_clicks) : 0;
        const adDerived = computeDerived({
          revenue: sale.revenue,
          spend: adSpendValue,
          sales: sale.sales,
        });
        return {
          adId,
          name: nameByAd.get(adId)?.name ?? `Anúncio ${adId}`,
          campaign: nameByAd.get(adId)?.campaign_name ?? "—",
          sales: sale.sales,
          revenue: sale.revenue,
          spend: adSpendValue,
          roas: adDerived.roas,
          cpa: adDerived.cpa,
          impressions,
          linkClicks,
          ctr: impressions > 0 ? (linkClicks / impressions) * 100 : null,
          cpc: linkClicks > 0 ? adSpendValue / linkClicks : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);

    // Regiões por DDD do telefone do comprador
    const regionData: Record<string, RegionDatum> = {};
    let salesWithoutPhone = 0;
    for (const row of phoneSales) {
      const uf = dddToUf(row.phone);
      if (!uf) {
        salesWithoutPhone += row.sales;
        continue;
      }
      const current = regionData[uf] ?? { sales: 0, revenue: 0 };
      current.sales += row.sales;
      current.revenue += Number(row.revenue);
      regionData[uf] = current;
    }
    const regionRows = Object.entries(regionData)
      .map(([uf, datum]) => ({
        uf,
        name: UF_NAMES[uf] ?? uf,
        ...datum,
        share: sales > 0 ? (datum.sales / sales) * 100 : 0,
      }))
      .sort((a, b) => b.sales - a.sales);

    const roasText = derived.roas === null ? "—" : `${derived.roas.toFixed(2).replace(".", ",")}x`;
    const cpaText = derived.cpa === null ? "—" : moneySpend.format(derived.cpa);
    const ticketText = derived.ticket === null ? "—" : money.format(derived.ticket);
    const lastMetaDate = spendRow?.last_date
      ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
          new Date(`${spendRow.last_date}T00:00:00Z`),
        )
      : null;

    content = (
      <div className="dashboard-main">
        <header className="dashboard-titlebar compact-titlebar">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h1>Dashboard Inteligente</h1>
            <p className="dashboard-context">
              Vendas da Lastlink cruzadas com o gasto da Meta Ads pelo ID do anúncio:
              faturamento, lucro e performance de cada anúncio em um só lugar.
            </p>
          </div>
        </header>

        <section className="executive-grid" aria-label="Indicadores do cruzamento">
          <article className="kpi-card kpi-primary">
            <div><span className="kpi-icon">R$</span><p>Faturamento bruto</p></div>
            <strong>{money.format(revenue)}</strong>
            <DeltaLine value={days === null ? null : deltaPercent(revenue, revenuePrev)} />
          </article>
          <article className="kpi-card">
            <div><span className="kpi-icon">◉</span><p>Gasto com ads</p></div>
            <strong>{hasMetaData ? moneySpend.format(spend) : "Sem dados"}</strong>
            {hasMetaData ? (
              <DeltaLine value={days === null ? null : deltaPercent(spend, spendPrev)} invert />
            ) : (
              <small>Conecte a Meta Ads em Integrações</small>
            )}
          </article>
          <article className="kpi-card">
            <div><span className="kpi-icon">↗</span><p>Lucro</p></div>
            <strong>{money.format(derived.profit)}</strong>
            <DeltaLine
              value={days === null ? null : deltaPercent(derived.profit, derivedPrev.profit)}
            />
          </article>
          <article className="kpi-card">
            <div><span className="kpi-icon">✓</span><p>Vendas aprovadas</p></div>
            <strong>{number.format(sales)}</strong>
            <DeltaLine value={days === null ? null : deltaPercent(sales, salesPrev)} />
          </article>
          <article className="kpi-card">
            <div><span className="kpi-icon">×</span><p>ROAS</p></div>
            <strong>{roasText}</strong>
            <DeltaLine
              value={
                days === null || derived.roas === null || derivedPrev.roas === null
                  ? null
                  : deltaPercent(derived.roas, derivedPrev.roas)
              }
            />
          </article>
          <article className="kpi-card">
            <div><span className="kpi-icon">◎</span><p>CPA</p></div>
            <strong>{cpaText}</strong>
            <DeltaLine
              value={
                days === null || derived.cpa === null || derivedPrev.cpa === null
                  ? null
                  : deltaPercent(derived.cpa, derivedPrev.cpa)
              }
              invert
            />
          </article>
          <article className="kpi-card">
            <div><span className="kpi-icon">⌀</span><p>Ticket médio</p></div>
            <strong>{ticketText}</strong>
            <DeltaLine
              value={
                days === null || derived.ticket === null || derivedPrev.ticket === null
                  ? null
                  : deltaPercent(derived.ticket, derivedPrev.ticket)
              }
            />
          </article>
        </section>

        <section className="analytics-grid">
          <article className="dashboard-card performance-card">
            <header className="card-header">
              <div>
                <p className="panel-label">Cruzamento diário</p>
                <h2>Faturamento vs gasto</h2>
              </div>
              <div className="di-legend">
                <span><i className="di-swatch di-swatch-revenue" />Faturamento</span>
                <span><i className="di-swatch di-swatch-spend" />Gasto</span>
              </div>
            </header>
            <CrossChart rows={dailyRows} money={money} />
            <footer className="chart-footer">
              <span>{period.description}</span>
              <span>
                Faturamento {money.format(revenue)} · Gasto {moneySpend.format(spend)}
              </span>
            </footer>
          </article>

          <article className="dashboard-card">
            <header className="card-header">
              <div>
                <p className="panel-label">Ao vivo</p>
                <h2>Vendas recentes</h2>
              </div>
              <span className="di-live-dot" aria-hidden="true" />
            </header>
            {recentSales.length === 0 ? (
              <p className="di-empty">Nenhuma venda aprovada registrada ainda.</p>
            ) : (
              <ul className="di-feed">
                {recentSales.map((sale, index) => {
                  const uf = dddToUf(sale.phone);
                  const when = new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: project.timezone,
                  }).format(new Date(sale.occurred_at));
                  return (
                    <li key={index}>
                      <div>
                        <strong>{sale.product_name ?? "Produto"}</strong>
                        <small>
                          {when}
                          {uf ? ` · ${UF_NAMES[uf] ?? uf}` : ""}
                        </small>
                      </div>
                      <span className="di-feed-value">+{money.format(Number(sale.amount))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </section>

        <section className="dashboard-card">
          <header className="card-header">
            <div>
              <p className="panel-label">Geografia das vendas</p>
              <h2>Vendas por região</h2>
            </div>
            <span className="di-note">Estimativa pelo DDD do telefone do comprador</span>
          </header>
          <div className="di-region-layout">
            <BrazilMap data={regionData} money={money} />
            <div className="di-region-list">
              {regionRows.length === 0 ? (
                <p className="di-empty">
                  Sem vendas com telefone identificado neste período.
                </p>
              ) : (
                <ul>
                  {regionRows.slice(0, 10).map((row) => (
                    <li key={row.uf}>
                      <div className="di-region-row">
                        <span>
                          <strong>{row.uf}</strong> {row.name}
                        </span>
                        <span>
                          {row.sales} venda(s) · {row.share.toFixed(1).replace(".", ",")}%
                        </span>
                      </div>
                      <div className="di-share">
                        <span style={{ width: `${Math.min(row.share, 100)}%` }} />
                      </div>
                      <small>{money.format(row.revenue)}</small>
                    </li>
                  ))}
                </ul>
              )}
              {salesWithoutPhone > 0 ? (
                <p className="di-note">
                  {salesWithoutPhone} venda(s) sem telefone identificado ficaram fora do mapa.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="dashboard-card">
          <header className="card-header">
            <div>
              <p className="panel-label">Rastreado via ID do anúncio</p>
              <h2>Performance por anúncio</h2>
            </div>
          </header>
          {adRows.length === 0 && organic.sales === 0 ? (
            <p className="di-empty">
              Nada para cruzar neste período: sem vendas atribuídas e sem insights da Meta.
              Confira se os anúncios usam utm_content com o ID do anúncio.
            </p>
          ) : (
            <div className="di-table-wrap">
              <table className="di-table">
                <thead>
                  <tr>
                    <th>Anúncio</th>
                    <th>Campanha</th>
                    <th>Vendas</th>
                    <th>Receita</th>
                    <th>Gasto</th>
                    <th>ROAS</th>
                    <th>CPA</th>
                    <th>Impressões</th>
                    <th>Cliques no link</th>
                    <th>CTR</th>
                    <th>CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {adRows.map((row) => (
                    <tr key={row.adId}>
                      <td>
                        <strong>{row.name}</strong>
                        <small>{row.adId}</small>
                      </td>
                      <td>{row.campaign}</td>
                      <td>{number.format(row.sales)}</td>
                      <td>{money.format(row.revenue)}</td>
                      <td>{moneySpend.format(row.spend)}</td>
                      <td>{row.roas === null ? "—" : `${row.roas.toFixed(2).replace(".", ",")}x`}</td>
                      <td>{row.cpa === null ? "—" : moneySpend.format(row.cpa)}</td>
                      <td>{number.format(row.impressions)}</td>
                      <td>{number.format(row.linkClicks)}</td>
                      <td>{row.ctr === null ? "—" : `${row.ctr.toFixed(2).replace(".", ",")}%`}</td>
                      <td>{row.cpc === null ? "—" : moneySpend.format(row.cpc)}</td>
                    </tr>
                  ))}
                  {organic.sales > 0 ? (
                    <tr className="di-organic-row">
                      <td>
                        <strong>Orgânico / sem anúncio</strong>
                        <small>sem utm_content com ID</small>
                      </td>
                      <td>—</td>
                      <td>{number.format(organic.sales)}</td>
                      <td>{money.format(organic.revenue)}</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="metric-footnote">
          Fontes: Lastlink (vendas em produção) e Meta Ads (insights diários
          {lastMetaDate ? `, última métrica em ${lastMetaDate}` : ", sem métricas sincronizadas"}).
          O cruzamento usa o ID do anúncio presente no utm_content da venda; lucro é
          faturamento bruto menos gasto com ads. Regiões são estimadas pelo DDD do
          telefone do comprador, porque a Lastlink não envia cidade/UF.
          {spendRow && spendRow.currency !== project.currency
            ? ` Atenção: o gasto da Meta está em ${spendRow.currency} e o faturamento em ${project.currency}; lucro e ROAS são indicativos enquanto as moedas diferirem.`
            : ""}
        </p>
      </div>
    );
  } catch (error) {
    content = (
      <div className="dashboard-main">
        <header className="dashboard-titlebar compact-titlebar">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h1>Dashboard Inteligente</h1>
          </div>
        </header>
        <section className="dashboard-card">
          <header className="card-header">
            <div>
              <p className="panel-label">Erro ao carregar</p>
              <h2>Não foi possível montar o cruzamento agora</h2>
            </div>
          </header>
          <p className="di-empty">
            Tente recarregar a página. Se persistir, confira as integrações da Lastlink e da
            Meta Ads. Detalhe técnico: {error instanceof Error ? error.message : "erro desconhecido"}
          </p>
        </section>
      </div>
    );
  }

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/dashboard-inteligente" />
      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/dashboard-inteligente">
          <nav aria-label="Período do dashboard inteligente" className="period-filter topbar-period">
            {Object.entries(periods).map(([key, option]) => (
              <a
                aria-current={key === periodKey ? "page" : undefined}
                className={key === periodKey ? "period-active" : undefined}
                href={`/dashboard/dashboard-inteligente?period=${key}`}
                key={key}
              >
                {option.label}
              </a>
            ))}
          </nav>
        </DashboardTopbar>
        {content}
      </section>
    </main>
  );
}
