import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { queueMetaSyncIfStale, queueQuickMetaSync } from "../../../lib/meta-sync-queue";
import { calendarDateInTimeZone } from "../../../lib/calendar-date";
import { resolveDateRange } from "../../../lib/melhores-anuncios";
import {
  loadBusinessProjects,
  loadBusinessScope,
  resolveBusinessProjectId,
} from "../../../lib/business-projects";
import { loadIntelligenceData } from "../../../lib/intelligence-data";
import type { CreativeRow } from "../../../lib/intelligence-data";
import { InteligenciaFilters } from "./inteligencia-filters";
import { InteligenciaPanels } from "./inteligencia-panels";
import { InteligenciaShell } from "./inteligencia-shell";
import { InteligenciaChatPanel } from "./chat-panel";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    from?: string;
    to?: string;
    period?: string;
    account?: string | string[];
    projeto?: string;
  }>;
};

function selectedAccounts(raw: string | string[] | undefined, valid: Set<string>): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? ""])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return parts.filter((id) => valid.has(id));
}

function sumMoney(rows: CreativeRow[]): { count: number; spend: number; revenue: number } {
  return {
    count: rows.length,
    spend: rows.reduce((sum, r) => sum + r.spend, 0),
    revenue: rows.reduce((sum, r) => sum + r.revenue, 0),
  };
}

export default async function InteligenciaPage({ searchParams }: PageProps) {
  const params = await searchParams;
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

  const today = calendarDateInTimeZone(new Date(), project.timezone);
  const range = resolveDateRange(
    { from: params.from, to: params.to, period: params.period },
    today,
  );

  let content: ReactNode;
  try {
    const accounts = (
      await database.pool.query<{ id: string; name: string; business_project_id: string | null }>(
        `select id, name, business_project_id::text as business_project_id
           from public.meta_ad_accounts where project_id = $1 order by name`,
        [project.id],
      )
    ).rows;
    const businessProjects = await loadBusinessProjects(database.pool, project.id).catch(() => []);
    const businessId = resolveBusinessProjectId(params.projeto, businessProjects);
    const businessScope = businessId
      ? await loadBusinessScope(database.pool, project.id, businessId).catch(() => null)
      : null;
    const selected = selectedAccounts(params.account, new Set(accounts.map((a) => a.id)));
    let accountFilter: string[] | null;
    if (businessScope) {
      accountFilter = selected.length
        ? selected.filter((id) => businessScope.accountIds.includes(id))
        : businessScope.accountIds;
    } else {
      accountFilter = selected.length ? selected : null;
    }
    const effectiveSelected = accountFilter ?? [];

    const data = await loadIntelligenceData(database.pool, {
      projectId: project.id,
      organizationId: project.organization_id,
      userAuthId: authData.user.id,
      from: range.from,
      to: range.to,
      accountIds: accountFilter,
      businessId,
      timezone: project.timezone,
    });

    const money = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: project.currency,
    });
    const renovarMap = new Map<string, CreativeRow>();
    for (const row of [...data.board.novo_gancho, ...data.board.mesmo_gancho, ...data.board.aposentar]) {
      renovarMap.set(row.creativeId, row);
    }
    const cards = [
      { label: "Escalar agora", ...sumMoney(data.board.escalar) },
      { label: "Duplicar", ...sumMoney(data.board.duplicar) },
      { label: "Levar pra outra conta", ...sumMoney(data.board.outra_conta) },
      { label: "Renovar criativo", ...sumMoney([...renovarMap.values()]) },
    ];

    const businessName = businessId
      ? (businessProjects.find((p) => p.id === businessId)?.name ?? "projeto")
      : "todos os projetos";
    const scopeLabel = `${range.label} · ${businessName} · ${
      accountFilter ? `${accountFilter.length} conta(s)` : "todas as contas"
    }`;

    const appUser = (
      await database.pool.query<{ id: string }>(
        `select id from public.users where auth_user_id = $1 limit 1`,
        [authData.user.id],
      )
    ).rows[0];
    const chatHistory = appUser
      ? (
          await database.pool.query<{ role: "user" | "assistant"; content: string }>(
            `select role, content from public.intelligence_chat_messages
              where project_id = $1 and user_id = $2
              order by created_at desc limit 50`,
            [project.id, appUser.id],
          )
        ).rows.reverse()
      : [];
    const openRouterConfig = (
      await database.pool.query<{ analysis_model: string | null }>(
        `select configuration->>'analysisModel' as analysis_model
           from public.connections
          where project_id = $1 and provider = 'openrouter' and status = 'active'
          order by created_at desc limit 1`,
        [project.id],
      )
    ).rows[0];
    const configuredModel = openRouterConfig?.analysis_model?.trim() ?? "";
    const chatModels = [
      configuredModel,
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4o-mini",
    ].filter((value, index, list) => value && list.indexOf(value) === index);

    content = (
      <div className="dashboard-main">
        <InteligenciaFilters
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, businessId: a.business_project_id }))}
          businessProjects={businessProjects.map((p) => ({ id: p.id, name: p.name }))}
          initial={{
            from: range.from,
            to: range.to,
            preset: range.preset,
            businessId,
            accountIds: effectiveSelected,
          }}
        />
        <section
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            marginBottom: 16,
          }}
        >
          {cards.map((card) => (
            <article key={card.label} className="dashboard-card" style={{ padding: 14 }}>
              <p className="panel-label">{card.label}</p>
              <h2 style={{ margin: "4px 0" }}>{card.count}</h2>
              <p className="metric-footnote" style={{ margin: 0 }}>
                {money.format(card.revenue)} de receita · {money.format(card.spend)} investidos
                no período
              </p>
            </article>
          ))}
        </section>
        <InteligenciaShell
          panels={
            <InteligenciaPanels
              currency={project.currency}
              businessId={businessId}
              thresholds={data.thresholds}
              campaigns={data.campaigns}
              creatives={data.creatives}
              formats={data.formats}
              hooks={data.hooks}
              board={data.board}
            />
          }
          chat={
            <InteligenciaChatPanel
              configured={Boolean(configuredModel)}
              models={chatModels}
              defaultModel={configuredModel || "anthropic/claude-sonnet-4.5"}
              initialMessages={chatHistory}
              filters={{
                from: range.from,
                to: range.to,
                businessId,
                accountIds: accountFilter,
              }}
              scopeLabel={scopeLabel}
            />
          }
        />
        {data.organic.sales > 0 ? (
          <p className="metric-footnote">
            Fora dos rankings: {data.organic.sales} venda(s) sem anúncio identificado (orgânico
            ou sem ID no utm_content), {money.format(data.organic.revenue)} em receita.
          </p>
        ) : null}
      </div>
    );
  } catch (error) {
    content = (
      <div className="dashboard-main">
        <section className="dashboard-card">
          <header className="card-header">
            <div>
              <p className="panel-label">Erro ao carregar</p>
              <h2>Não foi possível montar a Inteligência agora</h2>
            </div>
          </header>
          <p>
            Tente recarregar a página. Detalhe técnico:{" "}
            {error instanceof Error ? error.message : "erro desconhecido"}
          </p>
        </section>
      </div>
    );
  }

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/inteligencia" />
      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/inteligencia" />
        {content}
      </section>
    </main>
  );
}
