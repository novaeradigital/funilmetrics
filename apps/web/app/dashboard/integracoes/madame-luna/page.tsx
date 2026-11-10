import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { DashboardTopbar } from "../../dashboard-topbar";
import { createMadameLunaConnection, rotateMadameLunaSecret } from "./actions";

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
        where c.project_id=$1 and c.provider='madame_luna'
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
          returnTo="/dashboard/integracoes/madame-luna"
          statusLabel="Conexão Madame Luna"
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
              <h1>Madame Luna</h1>
              <p className="dashboard-context">
                Receba as vendas do checkout próprio da Madame Luna (os dois
                sistemas, app e tr) pelo webhook que o próprio app dela
                emite. O Purchase para a Meta continua sendo enviado pela
                CAPI da Luna: esta conexão é só ingestão, para a receita e a
                atribuição aparecerem nas telas do Funil. O segredo é você
                quem define aqui, e o mesmo valor vai no .env dos dois
                sistemas da Luna.
              </p>
            </div>
          </header>
          <section className="analytics-grid">
            <article className="dashboard-card">
              <h2>Nova conexão</h2>
              <form action={createMadameLunaConnection}>
                <label>
                  Nome
                  <input name="name" placeholder="Luna (app + tr)" required />
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
                  Segredo do webhook
                  <input
                    name="secret"
                    type="password"
                    autoComplete="off"
                    placeholder="Defina um segredo forte (mínimo 8 caracteres)"
                    required
                  />
                </label>
                <small>
                  Defina o segredo aqui e use o mesmo valor na variável
                  FUNIL_WEBHOOK_SECRET do .env dos dois sistemas da Luna
                  (app e tr). Ele fica guardado criptografado e é a chave
                  que assina cada entrega do app dela, servindo para
                  conferir que os eventos vieram mesmo da Luna.
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
              <h2>Conexões Madame Luna</h2>
              {connections.length ? (
                <div className="members-list">
                  {connections.map((connection) => {
                    const url = `${api}/webhooks/madame-luna/${connection.public_id}`;
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
                              No .env dos dois sistemas da Luna, configure
                              FUNIL_WEBHOOK_URL com esta URL e
                              FUNIL_WEBHOOK_SECRET com o segredo definido
                              nesta conexão. O app dela emite pagamento
                              aprovado, reembolso e chargeback, assinados
                              com esse segredo.
                            </small>
                          </p>
                          {canEdit ? (
                            <details>
                              <summary>Trocar o segredo</summary>
                              <form action={rotateMadameLunaSecret}>
                                <input
                                  type="hidden"
                                  name="connection_id"
                                  value={connection.id}
                                />
                                <label>
                                  Novo segredo
                                  <input
                                    name="secret"
                                    type="password"
                                    autoComplete="off"
                                    required
                                  />
                                </label>
                                <small>
                                  Atualize o FUNIL_WEBHOOK_SECRET no .env
                                  dos dois sistemas da Luna na mesma hora: o
                                  segredo anterior continua válido por 7 dias
                                  para os reenvios chegarem.
                                </small>
                                <button>Salvar novo segredo</button>
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
