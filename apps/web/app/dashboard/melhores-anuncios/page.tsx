import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { queueMetaSyncIfStale, queueQuickMetaSync } from "../../../lib/meta-sync-queue";
import { computeDerived, extractAdId } from "../../../lib/dashboard-inteligente";
import { bodyRate, hookRate } from "../../../lib/melhores-anuncios";
import {
  MelhoresAnunciosClient,
  type BestAdViewRow,
  type FunnelTotals,
} from "./melhores-anuncios-client";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ period?: string; account?: string | string[] }> };

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

function actionSum(actionType: string): string {
  return `sum(coalesce((
    select sum((elem ->> 'value')::numeric)
      from jsonb_array_elements(coalesce(actions, '[]'::jsonb)) elem
     where elem ->> 'action_type' = '${actionType}'), 0))::text`;
}

type AccountOption = { id: string; name: string };
type UtmSales = { utm_content: string | null; sales: number; revenue: string };
type AdInsights = {
  external_ad_id: string;
  account_id: string | null;
  spend: string;
  impressions: string;
  reach: string;
  link_clicks: string;
  page_views: string;
  checkouts: string;
  views_3s: string | null;
  thruplay: string | null;
  p75: string | null;
};
type AdName = {
  external_id: string;
  name: string;
  campaign_name: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
};

function selectedAccounts(raw: string | string[] | undefined, valid: Set<string>): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? ""])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return parts.filter((id) => valid.has(id));
}

export default async function MelhoresAnunciosPage({ searchParams }: PageProps) {
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
  after(async () => {
    await queueMetaSyncIfStale(database.pool, {
      organizationId: project.organization_id,
      projectId: project.id,
      authUserId: authData.user.id,
    }).catch(() => 0);
    await queueQuickMetaSync(database.pool, {
      organizationId: project.organization_id,
      projectId: project.id,
      authUserId: authData.user.id,
    }).catch(() => []);
  });
  const userId = authData.user.id;
  const days = period.days;

  let content: ReactNode;
  try {
    const accounts = (
      await database.pool.query<AccountOption>(
        `select id, name from public.meta_ad_accounts where project_id = $1 order by name`,
        [project.id],
      )
    ).rows;
    const accountIds = selectedAccounts(params.account, new Set(accounts.map((a) => a.id)));
    const accountFilter = accountIds.length ? accountIds : null;
    const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

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

    const adInsights = (
      await database.pool.query<AdInsights>(
        `select external_ad_id,
           max(meta_ad_account_id::text) as account_id,
           coalesce(sum(spend_base), 0)::text as spend,
           sum(impressions)::text as impressions,
           sum(reach)::text as reach,
           ${actionSum("link_click")} as link_clicks,
           ${actionSum("landing_page_view")} as page_views,
           ${actionSum("initiate_checkout")} as checkouts,
           sum(video_views_3s)::text as views_3s,
           sum(video_thruplay_views)::text as thruplay,
           sum(video_p75_views)::text as p75
           from public.meta_ad_insights_daily
          where project_id = $1
            and conversion_status in ('converted', 'not_required')
            and ($2::int is null or metric_date >= current_date - ($2::int - 1))
            and ($3::uuid[] is null or meta_ad_account_id = any($3))
          group by external_ad_id`,
        [project.id, days, accountFilter],
      )
    ).rows;

    const adNames = (
      await database.pool.query<AdName>(
        `select ad.external_id, ad.name, campaign.name as campaign_name,
           creative.thumbnail_url, creative.image_url
           from public.meta_ads ad
           left join public.meta_campaigns campaign on campaign.id = ad.meta_campaign_id
           left join public.meta_creatives creative on creative.id = ad.meta_creative_id
          where ad.project_id = $1`,
        [project.id],
      )
    ).rows;
    const nameByAd = new Map(adNames.map((row) => [row.external_id, row]));

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

    const insightsByAd = new Map(adInsights.map((row) => [row.external_ad_id, row]));
    const adIds = new Set([...salesByAd.keys(), ...insightsByAd.keys()]);
    const rows: BestAdViewRow[] = [...adIds].map((adId) => {
      const sale = salesByAd.get(adId) ?? { sales: 0, revenue: 0 };
      const insight = insightsByAd.get(adId);
      const spend = insight ? Number(insight.spend) : 0;
      const impressions = insight ? Number(insight.impressions) : 0;
      const reach = insight ? Number(insight.reach) : 0;
      const linkClicks = insight ? Number(insight.link_clicks) : 0;
      const views3s = insight?.views_3s != null ? Number(insight.views_3s) : null;
      const thruplay = insight?.thruplay != null ? Number(insight.thruplay) : null;
      const p75 = insight?.p75 != null ? Number(insight.p75) : null;
      const derived = computeDerived({ revenue: sale.revenue, spend, sales: sale.sales });
      const info = nameByAd.get(adId);
      return {
        adId,
        name: info?.name ?? `Anúncio ${adId}`,
        campaign: info?.campaign_name ?? "—",
        accountName: insight?.account_id ? (accountNameById.get(insight.account_id) ?? "") : "",
        thumbnailUrl: info?.image_url || info?.thumbnail_url || null,
        spend,
        impressions,
        reach,
        linkClicks,
        pageViews: insight ? Number(insight.page_views) : 0,
        checkouts: insight ? Number(insight.checkouts) : 0,
        sales: sale.sales,
        revenue: sale.revenue,
        roas: derived.roas,
        cpa: derived.cpa,
        profit: derived.profit,
        ticket: derived.ticket,
        ctr: impressions > 0 && insight ? (linkClicks / impressions) * 100 : null,
        cpc: linkClicks > 0 ? spend / linkClicks : null,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
        frequency: reach > 0 ? impressions / reach : null,
        hook: hookRate(views3s, impressions),
        body: bodyRate(thruplay, views3s),
        p75Rate: p75 !== null && views3s !== null && views3s > 0 ? (p75 / views3s) * 100 : null,
      };
    });

    const funnel: FunnelTotals = {
      impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
      linkClicks: rows.reduce((sum, row) => sum + row.linkClicks, 0),
      pageViews: rows.reduce((sum, row) => sum + row.pageViews, 0),
      checkouts: rows.reduce((sum, row) => sum + row.checkouts, 0),
      sales: rows.reduce((sum, row) => sum + row.sales, 0),
    };

    const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: project.currency });
    const number = new Intl.NumberFormat("pt-BR");

    content = (
      <div className="dashboard-main">
        <header className="dashboard-titlebar compact-titlebar">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h1>Melhores anúncios</h1>
            <p className="ma-subtitle">
              Ranking por vendas reais atribuídas, com o funil invertido e a retenção de vídeo de
              cada criativo. {period.description}.
            </p>
          </div>
        </header>

        <form className="ma-accounts" method="get">
          <input type="hidden" name="period" value={periodKey} />
          <span className="ma-accounts-label">Contas de anúncios</span>
          {accounts.map((account) => (
            <label key={account.id}>
              <input
                type="checkbox"
                name="account"
                value={account.id}
                defaultChecked={accountIds.includes(account.id)}
              />
              {account.name}
            </label>
          ))}
          <button type="submit">Aplicar</button>
          {accountIds.length ? (
            <a href={`/dashboard/melhores-anuncios?period=${periodKey}`}>Todas as contas</a>
          ) : null}
        </form>

        {rows.length === 0 ? (
          <section className="dashboard-card">
            <header className="card-header">
              <div>
                <p className="panel-label">Sem dados no período</p>
                <h2>Nada para ranquear ainda</h2>
              </div>
            </header>
            <p className="ma-empty">
              Sem vendas atribuídas e sem insights da Meta neste período. Confira se os anúncios
              usam utm_content com o ID do anúncio e se a sincronização da Meta está ativa em
              Integrações.
            </p>
          </section>
        ) : (
          <>
            <MelhoresAnunciosClient rows={rows} funnel={funnel} currency={project.currency} />
            {organic.sales > 0 ? (
              <p className="metric-footnote">
                Fora do ranking: {number.format(organic.sales)} venda(s) sem anúncio identificado
                (orgânico ou sem utm_content com ID), {money.format(organic.revenue)} em receita.
              </p>
            ) : null}
            <p className="metric-footnote">
              Fontes: vendas em produção cruzadas pelo ID do anúncio no utm_content e insights
              diários da Meta. Hook rate é a parcela das impressões que virou visualização de 3
              segundos; body rate é a parcela dessas visualizações que chegou ao thruplay. O
              risquinho nas barras marca 30%, referência visual de retenção saudável. Anúncio sem
              métrica de vídeo sincronizada mostra indisponível, nunca zero.
            </p>
          </>
        )}
      </div>
    );
  } catch (error) {
    content = (
      <div className="dashboard-main">
        <header className="dashboard-titlebar compact-titlebar">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h1>Melhores anúncios</h1>
          </div>
        </header>
        <section className="dashboard-card">
          <header className="card-header">
            <div>
              <p className="panel-label">Erro ao carregar</p>
              <h2>Não foi possível montar o ranking agora</h2>
            </div>
          </header>
          <p className="ma-empty">
            Tente recarregar a página. Se persistir, confira as integrações de vendas e da Meta
            Ads. Detalhe técnico: {error instanceof Error ? error.message : "erro desconhecido"}
          </p>
        </section>
      </div>
    );
  }

  const accountSuffix = (() => {
    const raw = params.account;
    const parts = (Array.isArray(raw) ? raw : [raw ?? ""])
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    return parts.length ? `&account=${parts.join(",")}` : "";
  })();

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/melhores-anuncios" />
      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/melhores-anuncios">
          <nav aria-label="Período dos melhores anúncios" className="period-filter topbar-period">
            {Object.entries(periods).map(([key, option]) => (
              <a
                aria-current={key === periodKey ? "page" : undefined}
                className={key === periodKey ? "period-active" : undefined}
                href={`/dashboard/melhores-anuncios?period=${key}${accountSuffix}`}
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
