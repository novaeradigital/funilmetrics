/**
 * Inteligencia (fase 1, D-186) - montagem dos dados da pagina.
 *
 * Cruza insights diarios da Meta (gasto e retencao do feed) com vendas
 * atribuidas pelo ID do anuncio no utm_content, a mesma regua do Dashboard
 * Inteligente e do Melhores Anuncios: receita = soma dos efeitos financeiros
 * positivos das vendas em producao (estagio bruto). Metrica sem fonte volta
 * null e a tela mostra "sem dados", nunca zero inventado.
 */
import type pg from "pg";
import { computeDerived, extractAdId } from "./dashboard-inteligente";
import { hookRate, bodyRate } from "./melhores-anuncios";
import {
  DEFAULT_THRESHOLDS,
  evaluateCreative,
  verdictCounts,
  type CreativeMetrics,
  type IntelligenceThresholds,
  type Verdict,
  type VerdictKind,
} from "./intelligence-rules";

export type IntelligenceScope = {
  projectId: string;
  organizationId: string;
  userAuthId: string;
  from: string | null;
  to: string | null;
  accountIds: string[] | null;
  businessId: string | null;
  timezone: string;
};

type AdInsightRow = {
  external_ad_id: string;
  account_id: string | null;
  campaign_id: string | null;
  spend: string;
  impressions: string;
  reach: string;
  link_clicks: string;
  views_3s: string | null;
  thruplay: string | null;
  p50: string | null;
  days_active: number;
  h1_impressions: string;
  h1_clicks: string;
  h2_impressions: string;
  h2_clicks: string;
};

function actionSum(actionType: string): string {
  return `sum(coalesce((
    select sum((elem ->> 'value')::numeric)
      from jsonb_array_elements(case when jsonb_typeof(actions) = 'array' then actions else '[]'::jsonb end) elem
     where elem ->> 'action_type' = '${actionType}'), 0))::text`;
}

function actionSumHalf(actionType: string, half: 1 | 2): string {
  const cond = half === 1 ? "metric_date <= $6::date" : "metric_date > $6::date";
  return `sum(coalesce((
    select sum((elem ->> 'value')::numeric)
      from jsonb_array_elements(case when jsonb_typeof(actions) = 'array' then actions else '[]'::jsonb end) elem
     where elem ->> 'action_type' = '${actionType}'), 0)) filter (where ${cond})::text`;
}

export type AdMetrics = {
  adId: string;
  name: string;
  campaignName: string;
  accountId: string | null;
  accountName: string;
  creativeId: string | null;
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  views3s: number | null;
  thruplay: number | null;
  p50: number | null;
  daysActive: number;
  sales: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  frequency: number | null;
  hookRate: number | null;
  thruRate: number | null;
  p50Rate: number | null;
};

export type CreativeRow = {
  creativeId: string;
  name: string;
  format: string | null;
  hook: string | null;
  thumbnailUrl: string | null;
  spend: number;
  sales: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  frequency: number | null;
  hookRate: number | null;
  thruRate: number | null;
  p50Rate: number | null;
  daysActive: number;
  verdicts: Verdict[];
};

export type CampaignRow = {
  campaignId: string;
  name: string;
  spend: number;
  sales: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  frequency: number | null;
  daysActive: number;
  thruRate: number | null;
  p50Rate: number | null;
  verdicts: VerdictKind[];
};

export type FormatRow = {
  format: string;
  creatives: number;
  spend: number;
  sales: number;
  revenue: number;
  roas: number | null;
  share: number | null;
};

export type HookRow = {
  hook: string;
  bodies: number;
  spend: number;
  sales: number;
  ctr: number | null;
  hookRate: number | null;
  thruRate: number | null;
};

export type IntelligenceData = {
  thresholds: IntelligenceThresholds;
  ads: AdMetrics[];
  creatives: CreativeRow[];
  campaigns: CampaignRow[];
  formats: FormatRow[];
  hooks: HookRow[];
  counts: { escalar: number; duplicar: number; outraConta: number; renovar: number };
  board: Record<VerdictKind, CreativeRow[]>;
  organic: { sales: number; revenue: number };
};

function midDate(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return new Date(a + Math.floor((b - a) / 2)).toISOString().slice(0, 10);
}

function ctrOf(clicks: number, impressions: number): number | null {
  return impressions > 0 ? (clicks / impressions) * 100 : null;
}

export async function loadThresholds(
  pool: pg.Pool,
  projectId: string,
  businessId: string | null,
): Promise<IntelligenceThresholds> {
  const row = (
    await pool.query<{ thresholds: Record<string, unknown> }>(
      `select thresholds from public.intelligence_settings
        where project_id = $1
          and coalesce(business_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        limit 1`,
      [projectId, businessId],
    )
  ).rows[0];
  const merged: IntelligenceThresholds = { ...DEFAULT_THRESHOLDS };
  if (row?.thresholds) {
    for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof IntelligenceThresholds)[]) {
      const value = Number(row.thresholds[key]);
      if (Number.isFinite(value) && value > 0) merged[key] = value;
    }
  }
  return merged;
}

export async function loadIntelligenceData(
  pool: pg.Pool,
  scope: IntelligenceScope,
): Promise<IntelligenceData> {
  const { projectId, from, to, accountIds, businessId } = scope;
  const mid = midDate(from, to);

  const accounts = (
    await pool.query<{ id: string; name: string; business_project_id: string | null }>(
      `select id::text as id, name, business_project_id::text as business_project_id
         from public.meta_ad_accounts where project_id = $1 order by name`,
      [projectId],
    )
  ).rows;
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const adInsights = (
    await pool.query<AdInsightRow>(
      `select external_ad_id,
         max(meta_ad_account_id::text) as account_id,
         max(meta_campaign_id::text) as campaign_id,
         coalesce(sum(spend_base), 0)::text as spend,
         coalesce(sum(impressions), 0)::text as impressions,
         coalesce(sum(reach), 0)::text as reach,
         ${actionSum("link_click")} as link_clicks,
         sum(video_views_3s)::text as views_3s,
         sum(video_thruplay_views)::text as thruplay,
         sum(video_p50_views)::text as p50,
         count(distinct metric_date) filter (where impressions > 0)::int as days_active,
         coalesce(sum(impressions) filter (where $6::date is not null and metric_date <= $6::date), 0)::text as h1_impressions,
         ${actionSumHalf("link_click", 1)} as h1_clicks,
         coalesce(sum(impressions) filter (where $6::date is not null and metric_date > $6::date), 0)::text as h2_impressions,
         ${actionSumHalf("link_click", 2)} as h2_clicks
         from public.meta_ad_insights_daily
        where project_id = $1
          and conversion_status in ('converted', 'not_required')
          and ($2::date is null or metric_date >= $2::date)
          and ($3::date is null or metric_date <= $3::date)
          and ($4::uuid[] is null or meta_ad_account_id = any($4))
        group by external_ad_id`,
      [projectId, from, to, accountIds, null, mid],
    )
  ).rows;

  const utmSales = (
    await pool.query<{ utm_content: string | null; sales: number; revenue: string }>(
      `with accessible_projects as (
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
       ),
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
          and ($2::date is null or (event.occurred_at at time zone $5)::date >= $2::date)
          and ($4::date is null or (event.occurred_at at time zone $5)::date <= $4::date)
        group by first_attr.utm_content`,
      [scope.userAuthId, from, projectId, to, scope.timezone],
    )
  ).rows;

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

  const adInfo = (
    await pool.query<{
      external_id: string;
      name: string;
      campaign_name: string | null;
      campaign_external_id: string | null;
      account_id: string | null;
      thumbnail_url: string | null;
      image_url: string | null;
    }>(
      `select ad.external_id, ad.name, campaign.name as campaign_name,
         campaign.external_id as campaign_external_id,
         ad.meta_ad_account_id::text as account_id,
         creative.thumbnail_url, creative.image_url
         from public.meta_ads ad
         left join public.meta_campaigns campaign on campaign.id = ad.meta_campaign_id
         left join public.meta_creatives creative on creative.id = ad.meta_creative_id
        where ad.project_id = $1`,
      [projectId],
    )
  ).rows;
  const infoByAd = new Map(adInfo.map((r) => [r.external_id, r]));

  // Anuncio -> criativo da biblioteca: publicacoes do sistema primeiro,
  // depois os vinculos sincronizados (creative_ad_links).
  const creativeByAd = new Map<string, string>();
  const uploadLinks = (
    await pool.query<{ creative_id: string; external_id: string }>(
      `select creative_id::text as creative_id, external_id
         from public.campaign_upload_items
        where upload_id in (select id from public.campaign_uploads where project_id = $1)
          and level = 'ad' and creative_id is not null and external_id is not null`,
      [projectId],
    )
  ).rows;
  for (const row of uploadLinks) creativeByAd.set(row.external_id, row.creative_id);
  const syncLinks = (
    await pool.query<{ creative_id: string; external_id: string }>(
      `select link.creative_id::text as creative_id, ad.external_id
         from public.creative_ad_links link
         join public.meta_ads ad on ad.id = link.meta_ad_id
        where ad.project_id = $1`,
      [projectId],
    )
  ).rows;
  for (const row of syncLinks) {
    if (!creativeByAd.has(row.external_id)) creativeByAd.set(row.external_id, row.creative_id);
  }

  const insightsByAd = new Map(adInsights.map((r) => [r.external_ad_id, r]));
  const allAdIds = new Set([...insightsByAd.keys(), ...salesByAd.keys()]);
  const ads: AdMetrics[] = [...allAdIds].map((adId) => {
    const ins = insightsByAd.get(adId);
    const sale = salesByAd.get(adId) ?? { sales: 0, revenue: 0 };
    const spend = ins ? Number(ins.spend) : 0;
    const impressions = ins ? Number(ins.impressions) : 0;
    const reach = ins ? Number(ins.reach) : 0;
    const linkClicks = ins ? Number(ins.link_clicks) : 0;
    const views3s = ins?.views_3s != null ? Number(ins.views_3s) : null;
    const thruplay = ins?.thruplay != null ? Number(ins.thruplay) : null;
    const p50 = ins?.p50 != null ? Number(ins.p50) : null;
    const derived = computeDerived({ revenue: sale.revenue, spend, sales: sale.sales });
    const info = infoByAd.get(adId);
    return {
      adId,
      name: info?.name ?? `Anúncio ${adId}`,
      campaignName: info?.campaign_name ?? "—",
      accountId: ins?.account_id ?? info?.account_id ?? null,
      accountName: ins?.account_id
        ? (accountNameById.get(ins.account_id) ?? "")
        : info?.account_id
          ? (accountNameById.get(info.account_id) ?? "")
          : "",
      creativeId: creativeByAd.get(adId) ?? null,
      spend,
      impressions,
      reach,
      linkClicks,
      views3s,
      thruplay,
      p50,
      daysActive: ins?.days_active ?? 0,
      sales: sale.sales,
      revenue: sale.revenue,
      roas: derived.roas,
      cpa: derived.cpa,
      ctr: ctrOf(linkClicks, impressions),
      frequency: reach > 0 ? impressions / reach : null,
      hookRate: hookRate(views3s, impressions),
      thruRate: bodyRate(thruplay, views3s),
      p50Rate:
        p50 !== null && views3s !== null && views3s > 0 ? (p50 / views3s) * 100 : null,
    };
  });

  // Analise mais recente por criativo (formato, gancho e miniatura dos anuncios).
  const creativeInfo = (
    await pool.query<{
      id: string;
      name: string;
      hook: string | null;
      format: string | null;
    }>(
      `select c.id::text as id, c.name,
         a.hook, a.format
         from public.creatives c
         left join lateral (
           select hook, format from public.creative_analyses
            where creative_id = c.id order by created_at desc limit 1
         ) a on true
        where c.project_id = $1`,
      [projectId],
    )
  ).rows;
  const infoByCreative = new Map(creativeInfo.map((r) => [r.id, r]));

  const thumbByCreative = new Map<string, string>();
  for (const ad of ads) {
    if (!ad.creativeId || thumbByCreative.has(ad.creativeId)) continue;
    const info = infoByAd.get(ad.adId);
    const thumb = info?.image_url || info?.thumbnail_url;
    if (thumb) thumbByCreative.set(ad.creativeId, thumb);
  }

  // Contas ativas do mesmo projeto de negocio (gasto nos ultimos 90 dias),
  // base da regra "outra conta".
  const activeAccounts = (
    await pool.query<{ id: string }>(
      `select distinct meta_ad_account_id::text as id
         from public.meta_ad_insights_daily
        where project_id = $1 and spend_base > 0
          and metric_date >= (current_date - interval '90 days')`,
      [projectId],
    )
  ).rows.map((r) => r.id);
  const activeSet = new Set(activeAccounts);

  const thresholds = await loadThresholds(pool, projectId, businessId);

  const states = (
    await pool.query<{ creative_id: string; verdict: string; state: string; snooze_until: Date | null }>(
      `select creative_id::text as creative_id, verdict, state, snooze_until
         from public.intelligence_card_states
        where project_id = $1
          and coalesce(business_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
      [projectId, businessId],
    )
  ).rows;
  const hidden = new Set<string>();
  const now = Date.now();
  for (const s of states) {
    if (s.state === "dismissed") hidden.add(`${s.creative_id}:${s.verdict}`);
    if (s.state === "snoozed" && s.snooze_until && s.snooze_until.getTime() > now)
      hidden.add(`${s.creative_id}:${s.verdict}`);
  }

  // Agregacao por criativo da biblioteca.
  type Agg = {
    spend: number; sales: number; revenue: number; impressions: number;
    reach: number; linkClicks: number;
    views3s: number | null; thruplay: number | null; p50: number | null;
    days: Set<number>; accounts: Set<string>;
    h1i: number; h1c: number; h2i: number; h2c: number;
  };
  const aggByCreative = new Map<string, Agg>();
  const insightByAdId = new Map(adInsights.map((r) => [r.external_ad_id, r]));
  for (const ad of ads) {
    if (!ad.creativeId) continue;
    const agg = aggByCreative.get(ad.creativeId) ?? {
      spend: 0, sales: 0, revenue: 0, impressions: 0, reach: 0, linkClicks: 0,
      views3s: null, thruplay: null, p50: null,
      days: new Set<number>(), accounts: new Set<string>(),
      h1i: 0, h1c: 0, h2i: 0, h2c: 0,
    };
    agg.spend += ad.spend;
    agg.sales += ad.sales;
    agg.revenue += ad.revenue;
    agg.impressions += ad.impressions;
    agg.reach += ad.reach;
    agg.linkClicks += ad.linkClicks;
    if (ad.views3s !== null) agg.views3s = (agg.views3s ?? 0) + ad.views3s;
    if (ad.thruplay !== null) agg.thruplay = (agg.thruplay ?? 0) + ad.thruplay;
    if (ad.p50 !== null) agg.p50 = (agg.p50 ?? 0) + ad.p50;
    if (ad.accountId) agg.accounts.add(ad.accountId);
    const ins = insightByAdId.get(ad.adId);
    if (ins) {
      agg.h1i += Number(ins.h1_impressions);
      agg.h1c += Number(ins.h1_clicks);
      agg.h2i += Number(ins.h2_impressions);
      agg.h2c += Number(ins.h2_clicks);
    }
    aggByCreative.set(ad.creativeId, agg);
  }
  // Dias ativos por criativo: dias distintos com impressao em qualquer anuncio.
  const creativeDays = (
    await pool.query<{ creative_id: string; days: number }>(
      `select mapped.creative_id::text as creative_id,
         count(distinct i.metric_date)::int as days
         from public.meta_ad_insights_daily i
         join (select external_id, creative_id from (
                select ad.external_id, item.creative_id
                  from public.campaign_upload_items item
                  join public.meta_ads ad on ad.external_id = item.external_id
                 where item.level = 'ad' and item.creative_id is not null
                union
                select ad.external_id, link.creative_id
                  from public.creative_ad_links link
                  join public.meta_ads ad on ad.id = link.meta_ad_id
               ) u) mapped on mapped.external_id = i.external_ad_id
        where i.project_id = $1 and i.impressions > 0
          and ($2::date is null or i.metric_date >= $2::date)
          and ($3::date is null or i.metric_date <= $3::date)
        group by mapped.creative_id`,
      [projectId, from, to],
    )
  ).rows;
  const daysByCreative = new Map(creativeDays.map((r) => [r.creative_id, r.days]));

  const creatives: CreativeRow[] = [];
  for (const [creativeId, agg] of aggByCreative) {
    const info = infoByCreative.get(creativeId);
    if (!info) continue;
    const derived = computeDerived({ revenue: agg.revenue, spend: agg.spend, sales: agg.sales });
    const businessOfCreative = new Set(
      [...agg.accounts]
        .map((id) => accounts.find((a) => a.id === id)?.business_project_id)
        .filter(Boolean) as string[],
    );
    const missingAccounts = accounts
      .filter(
        (a) =>
          a.business_project_id !== null &&
          businessOfCreative.has(a.business_project_id) &&
          !agg.accounts.has(a.id) &&
          activeSet.has(a.id),
      )
      .map((a) => ({ id: a.id, name: a.name }));
    const metrics: CreativeMetrics = {
      creativeId,
      spend: agg.spend,
      sales: agg.sales,
      revenue: agg.revenue,
      impressions: agg.impressions,
      reach: agg.reach,
      linkClicks: agg.linkClicks,
      views3s: agg.views3s,
      thruplay: agg.thruplay,
      roas: derived.roas,
      ctr: ctrOf(agg.linkClicks, agg.impressions),
      ctrFirstHalf: ctrOf(agg.h1c, agg.h1i),
      ctrSecondHalf: ctrOf(agg.h2c, agg.h2i),
      frequency: agg.reach > 0 ? agg.impressions / agg.reach : null,
      hookRate: hookRate(agg.views3s, agg.impressions),
      thruRate: bodyRate(agg.thruplay, agg.views3s),
      missingAccounts,
    };
    const verdicts = evaluateCreative(metrics, thresholds).filter(
      (v) => !hidden.has(`${creativeId}:${v.kind}`),
    );
    creatives.push({
      creativeId,
      name: info.name,
      format: info.format,
      hook: info.hook,
      thumbnailUrl: thumbByCreative.get(creativeId) ?? null,
      spend: agg.spend,
      sales: agg.sales,
      revenue: agg.revenue,
      roas: derived.roas,
      cpa: derived.cpa,
      ctr: metrics.ctr,
      frequency: metrics.frequency,
      hookRate: metrics.hookRate,
      thruRate: metrics.thruRate,
      p50Rate:
        agg.p50 !== null && agg.views3s !== null && agg.views3s > 0
          ? (agg.p50 / agg.views3s) * 100
          : null,
      daysActive: daysByCreative.get(creativeId) ?? 0,
      verdicts,
    });
  }
  creatives.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);

  // Campanhas: agregam os anuncios; vereditos = uniao dos criativos delas.
  const campMap = new Map<string, {
    name: string; spend: number; sales: number; revenue: number;
    impressions: number; reach: number; linkClicks: number;
    views3s: number | null; thruplay: number | null; p50: number | null;
    days: number; verdicts: Set<VerdictKind>;
  }>();
  const creativeVerdictByAd = new Map<string, VerdictKind[]>();
  for (const c of creatives) {
    for (const ad of ads) {
      if (ad.creativeId === c.creativeId)
        creativeVerdictByAd.set(ad.adId, c.verdicts.map((v) => v.kind));
    }
  }
  for (const ad of ads) {
    const info = infoByAd.get(ad.adId);
    const key = info?.campaign_external_id ?? ad.campaignName;
    const camp = campMap.get(key) ?? {
      name: ad.campaignName, spend: 0, sales: 0, revenue: 0, impressions: 0,
      reach: 0, linkClicks: 0, views3s: null, thruplay: null, p50: null,
      days: 0, verdicts: new Set<VerdictKind>(),
    };
    camp.spend += ad.spend;
    camp.sales += ad.sales;
    camp.revenue += ad.revenue;
    camp.impressions += ad.impressions;
    camp.reach += ad.reach;
    camp.linkClicks += ad.linkClicks;
    if (ad.views3s !== null) camp.views3s = (camp.views3s ?? 0) + ad.views3s;
    if (ad.thruplay !== null) camp.thruplay = (camp.thruplay ?? 0) + ad.thruplay;
    if (ad.p50 !== null) camp.p50 = (camp.p50 ?? 0) + ad.p50;
    camp.days = Math.max(camp.days, ad.daysActive);
    for (const kind of creativeVerdictByAd.get(ad.adId) ?? []) camp.verdicts.add(kind);
    campMap.set(key, camp);
  }
  const campaigns: CampaignRow[] = [...campMap.entries()].map(([campaignId, c]) => {
    const derived = computeDerived({ revenue: c.revenue, spend: c.spend, sales: c.sales });
    return {
      campaignId,
      name: c.name,
      spend: c.spend,
      sales: c.sales,
      revenue: c.revenue,
      roas: derived.roas,
      cpa: derived.cpa,
      ctr: ctrOf(c.linkClicks, c.impressions),
      frequency: c.reach > 0 ? c.impressions / c.reach : null,
      daysActive: c.days,
      thruRate: bodyRate(c.thruplay, c.views3s),
      p50Rate:
        c.p50 !== null && c.views3s !== null && c.views3s > 0
          ? (c.p50 / c.views3s) * 100
          : null,
      verdicts: [...c.verdicts],
    };
  });
  campaigns.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);

  // Formatos e ganchos a partir dos criativos ranqueados.
  const totalSpend = creatives.reduce((sum, c) => sum + c.spend, 0);
  const formatMap = new Map<string, FormatRow & { creatives: number }>();
  for (const c of creatives) {
    const key = c.format ?? "sem classificação";
    const row = formatMap.get(key) ?? {
      format: key, creatives: 0, spend: 0, sales: 0, revenue: 0, roas: null, share: null,
    };
    row.creatives += 1;
    row.spend += c.spend;
    row.sales += c.sales;
    row.revenue += c.revenue;
    formatMap.set(key, row);
  }
  const formats = [...formatMap.values()]
    .map((row) => ({
      ...row,
      roas: row.spend > 0 ? row.revenue / row.spend : null,
      share: totalSpend > 0 ? (row.spend / totalSpend) * 100 : null,
    }))
    .sort((a, b) => b.spend - a.spend);

  const hookMap = new Map<string, HookRow & { impressions: number; linkClicks: number; views3s: number | null; thruplay: number | null }>();
  for (const c of creatives) {
    if (!c.hook || !c.hook.trim()) continue;
    const key = c.hook.trim().toLowerCase();
    const agg = aggByCreative.get(c.creativeId);
    const row = hookMap.get(key) ?? {
      hook: c.hook.trim(), bodies: 0, spend: 0, sales: 0, ctr: null,
      hookRate: null, thruRate: null, impressions: 0, linkClicks: 0, views3s: null, thruplay: null,
    };
    row.bodies += 1;
    row.spend += c.spend;
    row.sales += c.sales;
    if (agg) {
      row.impressions += agg.impressions;
      row.linkClicks += agg.linkClicks;
      if (agg.views3s !== null) row.views3s = (row.views3s ?? 0) + agg.views3s;
      if (agg.thruplay !== null) row.thruplay = (row.thruplay ?? 0) + agg.thruplay;
    }
    hookMap.set(key, row);
  }
  const hooks: HookRow[] = [...hookMap.values()]
    .map((row) => ({
      hook: row.hook,
      bodies: row.bodies,
      spend: row.spend,
      sales: row.sales,
      ctr: ctrOf(row.linkClicks, row.impressions),
      hookRate: hookRate(row.views3s, row.impressions),
      thruRate: bodyRate(row.thruplay, row.views3s),
    }))
    .sort((a, b) => b.sales - a.sales || b.spend - a.spend);

  const board: Record<VerdictKind, CreativeRow[]> = {
    escalar: [], duplicar: [], outra_conta: [], novo_gancho: [], mesmo_gancho: [], aposentar: [],
  };
  for (const c of creatives) {
    for (const v of c.verdicts) board[v.kind].push(c);
  }

  return {
    thresholds,
    ads,
    creatives,
    campaigns,
    formats,
    hooks,
    counts: verdictCounts(creatives.map((c) => c.verdicts)),
    board,
    organic,
  };
}
