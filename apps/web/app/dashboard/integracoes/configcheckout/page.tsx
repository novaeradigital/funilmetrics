import { redirect } from "next/navigation";
import { getDatabase } from "../../../../lib/database";
import { createClient } from "../../../../lib/supabase/server";
import {
  createConfigCheckoutConnection,
  revokeConfigCheckoutConnection,
  rotateConfigCheckoutToken,
  testConfigCheckoutToken,
} from "./actions";
import {getActiveProject} from "../../../../lib/active-project";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; publicId?: string }>;
};

function percentage(part: number, total: number) {
  return total ? `${((part / total) * 100).toFixed(1)}%` : "—";
}

function ageLabel(value: Date | null) {
  if (!value) return "Sem pendências";
  const minutes = Math.max(0, Math.floor((Date.now() - value.getTime()) / 60000));
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} dia(s)`;
}

export default async function ConfigCheckoutIntegrationsPage({
  searchParams,
}: PageProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const [active,params]=await Promise.all([
    getActiveProject(data.user.id),searchParams,
  ]);
  if(!active.project)redirect("/dashboard/projetos");
  const projects=[active.project];

  const database = getDatabase();
  const result = await database.pool.query<{
    id: string;
    name: string;
    status: string;
    project_name: string;
    public_id: string;
    seller_id: string | null;
    production_products: string[] | null;
    last_event_at: Date | null;
    last_used_at: Date | null;
    production_events: number;
    test_events: number;
    backlog_events: number;
    failed_events: number;
    quarantined_events: number;
    events_24h: number;
    normalized_24h: number;
    duplicate_24h: number;
    partial_24h: number;
    failed_24h: number;
    quarantined_24h: number;
    oldest_backlog_at: Date | null;
    open_issues: number;
    critical_issues: number;
  }>(
    `select c.id, c.name, c.status, p.name as project_name, c.public_id,
            c.configuration->>'sellerId' as seller_id,
            products.production_products,
            c.last_event_at, endpoint.last_used_at,
            coalesce(events.production_events, 0)::int as production_events,
            coalesce(events.test_events, 0)::int as test_events,
            coalesce(events.backlog_events, 0)::int as backlog_events,
            coalesce(events.failed_events, 0)::int as failed_events,
            coalesce(events.quarantined_events, 0)::int as quarantined_events,
            coalesce(events.events_24h, 0)::int as events_24h,
            coalesce(events.normalized_24h, 0)::int as normalized_24h,
            coalesce(events.duplicate_24h, 0)::int as duplicate_24h,
            coalesce(events.partial_24h, 0)::int as partial_24h,
            coalesce(events.failed_24h, 0)::int as failed_24h,
            coalesce(events.quarantined_24h, 0)::int as quarantined_24h,
            events.oldest_backlog_at,
            coalesce(issues.open_issues, 0)::int as open_issues,
            coalesce(issues.critical_issues, 0)::int as critical_issues
       from public.connections c
       join public.projects p on p.id = c.project_id
       join public.users u on u.auth_user_id = $1
       join public.memberships m
         on m.organization_id = c.organization_id
        and m.user_id = u.id
       left join public.webhook_endpoints endpoint
         on endpoint.connection_id = c.id
       left join lateral (
         select
           array_agg(distinct product.name order by product.name)
             filter (where product.data_scope = 'production')
               as production_products
           from public.commerce_products product
          where product.connection_id = c.id
       ) products on true
       left join lateral (
         select
           count(*) filter (where event.is_test is false) as production_events,
           count(*) filter (where event.is_test is true) as test_events,
           count(*) filter (
             where event.processing_status in ('queued', 'processing')
           ) as backlog_events,
           count(*) filter (
             where event.processing_status in ('failed_retryable', 'failed_terminal')
           ) as failed_events,
           count(*) filter (
             where event.processing_status = 'quarantined'
           ) as quarantined_events,
           count(*) filter (
             where event.received_at >= now() - interval '24 hours'
           ) as events_24h,
           count(*) filter (
             where event.received_at >= now() - interval '24 hours'
               and event.processing_status = 'normalized'
           ) as normalized_24h,
           count(*) filter (
             where event.received_at >= now() - interval '24 hours'
               and event.processing_status = 'duplicate'
           ) as duplicate_24h,
           count(*) filter (
             where event.received_at >= now() - interval '24 hours'
               and event.validation_status = 'partial'
           ) as partial_24h,
           count(*) filter (
             where event.received_at >= now() - interval '24 hours'
               and event.processing_status in ('failed_retryable', 'failed_terminal')
           ) as failed_24h,
           count(*) filter (
             where event.received_at >= now() - interval '24 hours'
               and event.processing_status = 'quarantined'
           ) as quarantined_24h,
           min(event.received_at) filter (
             where event.processing_status in ('received', 'queued', 'processing')
           ) as oldest_backlog_at
           from public.raw_events event
          where event.connection_id = c.id
       ) events on true
       left join lateral (
         select count(*) as open_issues,
                count(*) filter (where issue.severity = 'critical') as critical_issues
           from public.data_quality_issues issue
          where issue.connection_id = c.id
            and issue.status = 'open'
       ) issues on true
      where c.provider = 'configcheckout' and c.project_id=$2
        and (
          not exists (
            select 1 from public.project_memberships restricted
             where restricted.membership_id = m.id
          )
          or exists (
            select 1 from public.project_memberships allowed
             where allowed.membership_id = m.id
               and allowed.project_id = c.project_id
          )
        )
      order by c.created_at desc`,
    [data.user.id,active.project.id],
  );

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ??
    "https://api.funilmetrics.site";
  const createdUrl =
    params.status === "created" && params.publicId
      ? `${apiBase}/webhooks/configcheckout/${params.publicId}`
      : null;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <a className="back-link" href="/dashboard">← Visão geral</a>
          <p className="eyebrow">Integrações</p>
          <h1>ConfigCheckout</h1>
          <p className="summary">
            Cadastre um endpoint por vendedor do ConfigCheckout. O token é salvo somente como hash
            e deve ser o mesmo informado nas Integrações do ConfigCheckout.
          </p>
        </div>
      </header>

      {params.status === "created" && createdUrl ? (
        <div className="notice notice-success">
          Conexão criada. Cadastre esta URL e o token nas Integrações do ConfigCheckout:
          <code className="webhook-url">{createdUrl}</code>
        </div>
      ) : null}
      {params.status === "invalid" ? (
        <div className="notice notice-error">
          Confira projeto, rótulo e token.
        </div>
      ) : null}
      {params.status === "forbidden" ? (
        <div className="notice notice-error">
          Você não tem permissão administrativa nesse projeto.
        </div>
      ) : null}
      {params.status === "error" ? (
        <div className="notice notice-error">
          Não foi possível criar a conexão. Tente novamente.
        </div>
      ) : null}
      {params.status === "token-valid" ? (
        <div className="notice notice-success">
          Token confirmado. Ele corresponde ao hash salvo.
        </div>
      ) : null}
      {params.status === "token-invalid" ? (
        <div className="notice notice-error">
          Token incorreto ou conexão inativa.
        </div>
      ) : null}
      {params.status === "rotated" ? (
        <div className="notice notice-success">
          Token rotacionado. O anterior será aceito por mais 24 horas.
        </div>
      ) : null}
      {params.status === "revoked" ? (
        <div className="notice notice-success">
          Conexão revogada. Novos webhooks serão recusados.
        </div>
      ) : null}
      {params.status === "confirmation-required" ? (
        <div className="notice notice-error">
          Digite REVOGAR para confirmar a revogação.
        </div>
      ) : null}

      <section className="integration-layout">
        <article className="panel">
          <p className="panel-label">Nova conexão</p>
          {projects?.length ? (
            <form action={createConfigCheckoutConnection} className="integration-form">
              <label>
                Projeto
                <select name="projectId" required>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rótulo da conexão
                <input name="label" minLength={3} required />
              </label>
              <label>
                ID do vendedor no ConfigCheckout, se disponível
                <input name="sellerId" inputMode="numeric" />
              </label>
              <label>
                Token do webhook
                <input
                  autoComplete="new-password"
                  minLength={12}
                  name="token"
                  required
                  type="password"
                />
              </label>
              <small>
                Depois de salvo, o token completo não poderá ser visualizado.
              </small>
              <button type="submit">Criar conexão</button>
            </form>
          ) : (
            <div className="empty-state">
              Nenhum projeto acessível. Solicite permissão a um administrador.
            </div>
          )}
        </article>

        <article className="panel">
          <p className="panel-label">Vendedores conectados</p>
          {result.rows.length ? (
            <div className="connection-list">
              {result.rows.map((connection) => (
                <section className="connection-card" key={connection.id}>
                  <div>
                    <strong>{connection.name}</strong>
                    <span>Projeto: {connection.project_name}</span>
                  </div>
                  <span className={`status-badge status-${connection.status}`}>
                    {connection.status === "active" ? "Ativa" : connection.status}
                  </span>
                  <code className="webhook-url">
                    {apiBase}/webhooks/configcheckout/{connection.public_id}
                  </code>
                  <div className="detected-products">
                    {connection.seller_id ? (
                      <>
                        <span>Vendedor no ConfigCheckout</span>
                        <strong>ID {connection.seller_id}</strong>
                      </>
                    ) : null}
                    <span>Produtos detectados nas vendas</span>
                    {connection.production_products?.length ? (
                      <div className="product-tags">
                        {connection.production_products.map((product) => (
                          <span className="product-tag" key={product}>
                            {product}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <small>Nenhum produto identificado ainda.</small>
                    )}
                  </div>
                  <div className="connection-health">
                    <div>
                      <span>Estado operacional</span>
                      <strong>
                        {connection.status === "revoked"
                          ? "Conexão revogada"
                          : connection.open_issues ||
                              connection.failed_24h ||
                              connection.quarantined_24h
                            ? "Requer atenção"
                            : connection.backlog_events
                              ? "Processando eventos"
                              : connection.last_event_at
                                ? "Recebendo eventos"
                                : "Aguardando primeiro evento"}
                      </strong>
                    </div>
                    <div className="health-metrics">
                      <span>
                        Produção <strong>{connection.production_events}</strong>
                      </span>
                      <span>
                        Testes <strong>{connection.test_events}</strong>
                      </span>
                      <span>
                        Backlog <strong>{connection.backlog_events}</strong>
                      </span>
                      <span>
                        Falhas <strong>{connection.failed_events}</strong>
                      </span>
                      <span>
                        Quarentena{" "}
                        <strong>{connection.quarantined_events}</strong>
                      </span>
                    </div>
                    <div className="connection-diagnostics">
                      <p>
                        <span>Últimas 24 horas</span>
                        <strong>{connection.events_24h} eventos</strong>
                      </p>
                      <p>
                        <span>Normalização</span>
                        <strong>
                          {percentage(connection.normalized_24h, connection.events_24h)}
                        </strong>
                      </p>
                      <p>
                        <span>Duplicados</span>
                        <strong>{connection.duplicate_24h}</strong>
                      </p>
                      <p>
                        <span>Parciais</span>
                        <strong>{connection.partial_24h}</strong>
                      </p>
                      <p>
                        <span>Falhas / quarentena</span>
                        <strong>
                          {connection.failed_24h} / {connection.quarantined_24h}
                        </strong>
                      </p>
                      <p>
                        <span>Item mais antigo no backlog</span>
                        <strong>{ageLabel(connection.oldest_backlog_at)}</strong>
                      </p>
                      <p>
                        <span>Alertas abertos</span>
                        <strong>
                          {connection.open_issues}
                          {connection.critical_issues
                            ? ` (${connection.critical_issues} crítico)`
                            : ""}
                        </strong>
                      </p>
                    </div>
                  </div>
                  <span>
                    Último evento:{" "}
                    {connection.last_event_at
                      ? new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "America/Sao_Paulo",
                        }).format(connection.last_event_at)
                      : "ainda não recebido"}
                  </span>
                  <details className="connection-actions">
                    <summary>Validar token</summary>
                    <form action={testConfigCheckoutToken}>
                      <input
                        name="connectionId"
                        type="hidden"
                        value={connection.id}
                      />
                      <label>
                        Cole o token atual
                        <input
                          autoComplete="new-password"
                          minLength={12}
                          name="token"
                          required
                          type="password"
                        />
                      </label>
                      <button type="submit">Validar</button>
                    </form>
                  </details>
                  <details className="connection-actions">
                    <summary>Rotacionar token</summary>
                    <form action={rotateConfigCheckoutToken}>
                      <input
                        name="connectionId"
                        type="hidden"
                        value={connection.id}
                      />
                      <label>
                        Novo token do webhook
                        <input
                          autoComplete="new-password"
                          minLength={12}
                          name="token"
                          required
                          type="password"
                        />
                      </label>
                      <small>
                        O token anterior permanece válido por 24 horas.
                      </small>
                      <button type="submit">Rotacionar</button>
                    </form>
                  </details>
                  {connection.status !== "revoked" ? (
                    <details className="connection-actions danger-zone">
                      <summary>Revogar conexão</summary>
                      <form action={revokeConfigCheckoutConnection}>
                        <input
                          name="connectionId"
                          type="hidden"
                          value={connection.id}
                        />
                        <label>
                          Digite REVOGAR para confirmar
                          <input
                            autoComplete="off"
                            name="confirmation"
                            pattern="REVOGAR"
                            required
                          />
                        </label>
                        <button className="danger-button" type="submit">
                          Revogar
                        </button>
                      </form>
                    </details>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              Nenhum vendedor ConfigCheckout conectado neste projeto.
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
