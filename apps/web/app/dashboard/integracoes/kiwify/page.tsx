import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { DashboardTopbar } from "../../dashboard-topbar";
import { createKiwifyConnection, rotateKiwifyToken } from "./actions";

export const dynamic = "force-dynamic";

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
  const businesses = (
    await db.pool.query<{ id: string; name: string }>(
      `select id::text as id, name from public.business_projects
        where project_id=$1 order by name`,
      [project.id],
    )
  ).rows;
  const connections = (
    await db.pool.query<{
      id: string;
      name: string;
      public_id: string;
      status: string;
      business_name: string | null;
      last_event_at: string | null;
    }>(
      `select c.id::text as id, c.name, c.public_id::text, c.status,
              b.name as business_name, c.last_event_at::text
         from public.connections c
         left join public.business_projects b on b.id = c.business_project_id
        where c.project_id=$1 and c.provider='kiwify'
        order by c.created_at desc`,
      [project.id],
    )
  ).rows;
  const api = process.env.NEXT_PUBLIC_API_URL ?? "https://api.funilmetrics.site";
  const canEdit = ["owner", "administrator"].includes(project.role);

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/integracoes" footerLabel="Integrações" />
      <section className="app-content">
        <DashboardTopbar
          returnTo="/dashboard/integracoes/kiwify"
          statusLabel="Conexão Kiwify"
        />
        <div className="dashboard-main">
          {params.status ? (
            <div
              className={
                ["created", "updated"].includes(params.status)
                  ? "notice notice-success"
                  : "notice notice-error"
              }
            >
              {["created", "updated"].includes(params.status)
                ? "Configuração salva e auditada."
                : "Não foi possível salvar a configuração."}
            </div>
          ) : null}
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Integrações · Checkout</p>
              <h1>Kiwify</h1>
              <p className="dashboard-context">
                Receba as vendas da Kiwify pelo webhook dela e envie o Purchase
                para a Meta pelo pixel do negócio. O token é você quem
                define ao criar o webhook na Kiwify, e o mesmo valor vai
                colado aqui.
              </p>
            </div>
          </header>
          <section className="analytics-grid">
            <article className="dashboard-card">
              <h2>Nova conexão</h2>
              <form action={createKiwifyConnection}>
                <label>
                  Nome
                  <input name="name" placeholder="Kiwify principal" required />
                </label>
                <label>
                  Projeto de negócio
                  <select name="business_project_id" defaultValue="">
                    <option value="">Sem negócio</option>
                    {businesses.map((business) => (
                      <option key={business.id} value={business.id}>
                        {business.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Token do webhook da Kiwify
                  <input
                    name="token"
                    type="password"
                    autoComplete="off"
                    placeholder="Cole o token gerado pela Kiwify ao criar o webhook"
                    required
                  />
                </label>
                <small>
                  Quem gera o token é a Kiwify, no formulário de criação do webhook (o campo vem preenchido e travado lá). Copie o valor de lá para cá. Ele fica guardado criptografado e é a chave que assina
                  cada entrega da Kiwify e serve para conferir que os
                  eventos vieram dela.
                </small>
                {canEdit ? (
                  <button>Criar conexão</button>
                ) : (
                  <p>
                    <small>Somente leitura para o seu papel.</small>
                  </p>
                )}
              </form>
            </article>
            <article className="dashboard-card">
              <h2>Conexões Kiwify</h2>
              {connections.length ? (
                <div className="members-list">
                  {connections.map((connection) => {
                    const url = `${api}/webhooks/kiwify/${connection.public_id}`;
                    return (
                      <div className="member-row" key={connection.id}>
                        <div>
                          <p>
                            <strong>{connection.name}</strong>
                            <small>
                              Negócio: {connection.business_name ?? "nenhum"}{" "}
                              ·{" "}
                              {connection.last_event_at
                                ? `último evento ${new Date(connection.last_event_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                                : "nenhum evento recebido"}
                            </small>
                            <code>{url}</code>
                            <small>
                              Na Kiwify, em Apps, Webhooks, crie um webhook com
                              esta URL. O campo Token já vem preenchido pela própria Kiwify: use em Trocar o token o mesmo valor que estiver lá. Ative os eventos de
                              compra aprovada, compra reembolsada,
                              chargeback, boleto gerado, pix gerado e compra
                              recusada. Carrinho abandonado fica fora desta
                              versão.
                            </small>
                          </p>
                          {canEdit ? (
                            <details>
                              <summary>Trocar o token</summary>
                              <form action={rotateKiwifyToken}>
                                <input
                                  type="hidden"
                                  name="connection_id"
                                  value={connection.id}
                                />
                                <label>
                                  Novo token da Kiwify
                                  <input
                                    name="token"
                                    type="password"
                                    autoComplete="off"
                                    required
                                  />
                                </label>
                                <small>
                                  Troque o token na Kiwify na mesma hora: o
                                  anterior continua válido por 7 dias para os
                                  reenvios dela chegarem.
                                </small>
                                <button>Salvar novo token</button>
                              </form>
                            </details>
                          ) : null}
                        </div>
                        <span className="member-role">
                          {connection.status === "active" ? "ATIVA" : connection.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="compact-empty">Nenhuma conexão criada.</div>
              )}
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}
