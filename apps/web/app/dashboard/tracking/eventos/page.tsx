import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import { loadMetaEventQueue } from "../../../../lib/meta-pixels";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { DashboardTopbar } from "../../dashboard-topbar";
import { TrackingTabs } from "../tabs";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  pending: "Na fila",
  processing: "Enviando",
  sent: "Enviado",
  blocked: "Bloqueado",
  failed: "Falhou",
  dead: "Descartado",
};

const statusFilters = [
  "pending",
  "processing",
  "sent",
  "blocked",
  "failed",
  "dead",
] as const;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { project } = await getActiveProject(data.user.id);
  if (!project) redirect("/dashboard/projetos");
  const db = getDatabase();
  const status =
    params.status && statusFilters.includes(params.status as never)
      ? params.status
      : undefined;
  const { rows, counts } = await loadMetaEventQueue(db, project.id, status);

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/tracking" footerLabel="Rastreamento" />
      <section className="app-content">
        <DashboardTopbar
          returnTo="/dashboard/tracking/eventos"
          statusLabel="Fila de eventos Meta"
        />
        <div className="dashboard-main">
          <TrackingTabs active="events" />
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Rastreamento · Meta</p>
              <h1>Eventos enviados</h1>
              <p className="dashboard-context">
                Cada linha é um evento da fila: PageView, ViewContent e
                InitiateCheckout das páginas e Purchase das vendas, com o
                resultado do envio para a Meta.
              </p>
            </div>
          </header>
          <div className="dashboard-filter-summary">
            <span>
              <Link href="/dashboard/tracking/eventos">Todos</Link>
            </span>
            {statusFilters.map((item) => (
              <span key={item}>
                <Link href={`/dashboard/tracking/eventos?status=${item}`}>
                  {statusLabels[item]}: {counts[item] ?? 0}
                </Link>
              </span>
            ))}
          </div>
          {rows.length ? (
            <div className="members-list">
              {rows.map((row) => (
                <div className="member-row" key={row.id}>
                  <p>
                    <strong>
                      {row.event_name}
                      {row.value ? ` · R$ ${row.value}` : ""}
                    </strong>
                    <small>
                      {row.business_name ?? "Sem negócio"} · pixel{" "}
                      {row.pixel_id} · {row.event_id}
                    </small>
                    <small>
                      Criado{" "}
                      {new Date(row.created_at).toLocaleString("pt-BR")}
                      {row.sent_at
                        ? ` · enviado ${new Date(row.sent_at).toLocaleString("pt-BR")}`
                        : ""}
                      {` · ${row.attempts} tentativa(s)`}
                    </small>
                    {row.last_error ? (
                      <small>Erro: {row.last_error}</small>
                    ) : null}
                    {row.blocked_reason ? (
                      <small>Motivo do bloqueio: {row.blocked_reason}</small>
                    ) : null}
                  </p>
                  <span className="member-role">
                    {statusLabels[row.status] ?? row.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="compact-empty">
              Nenhum evento na fila com este filtro.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
