import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import { loadBusinessMetaPixels } from "../../../../lib/meta-pixels";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { DashboardTopbar } from "../../dashboard-topbar";
import { TrackingTabs } from "../tabs";
import { saveBusinessMetaPixel } from "./actions";

export const dynamic = "force-dynamic";

const eventFields = [
  ["ev_page_view", "pageView", "PageView"],
  ["ev_view_content", "viewContent", "ViewContent"],
  ["ev_initiate_checkout", "initiateCheckout", "InitiateCheckout"],
  ["ev_purchase", "purchase", "Purchase"],
  ["ev_refund", "refund", "Refund (reembolso)"],
] as const;

const matchingFields = [
  ["match_email", "email", "E-mail"],
  ["match_phone", "phone", "Telefone"],
  ["match_first_name", "firstName", "Nome"],
  ["match_last_name", "lastName", "Sobrenome"],
  ["match_city", "city", "Cidade"],
  ["match_state", "state", "Estado"],
  ["match_zip", "zip", "CEP"],
  ["match_external_id", "externalId", "ID externo"],
  ["match_ip", "ip", "Endereço IP"],
  ["match_user_agent", "userAgent", "User agent"],
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
  const pixels = await loadBusinessMetaPixels(db, project.id);
  const canEdit = ["owner", "administrator"].includes(project.role);

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/tracking" footerLabel="Rastreamento" />
      <section className="app-content">
        <DashboardTopbar
          returnTo="/dashboard/tracking/pixels"
          statusLabel="Pixels Meta por projeto de negócio"
        />
        <div className="dashboard-main">
          <TrackingTabs active="pixels" />
          {params.status ? (
            <div
              className={
                params.status === "saved"
                  ? "notice notice-success"
                  : "notice notice-error"
              }
            >
              {params.status === "saved"
                ? "Configuração salva e auditada."
                : "Não foi possível salvar a configuração."}
            </div>
          ) : null}
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Rastreamento · Meta</p>
              <h1>Pixels Meta</h1>
              <p className="dashboard-context">
                Um pixel e um token de conversões por projeto de negócio. As
                fontes vinculadas ao negócio e as vendas dele alimentam a
                fila de eventos deste pixel.
              </p>
            </div>
          </header>
          {pixels.length ? (
            <section className="analytics-grid">
              {pixels.map((pixel) => (
                <article className="dashboard-card" key={pixel.business_project_id}>
                  <h2>{pixel.business_name}</h2>
                  <form action={saveBusinessMetaPixel}>
                    <input
                      type="hidden"
                      name="business_project_id"
                      value={pixel.business_project_id}
                    />
                    <label>
                      ID do pixel
                      <input
                        name="pixel_id"
                        defaultValue={pixel.pixel_id ?? ""}
                        placeholder="123456789012345"
                        required
                      />
                    </label>
                    <label>
                      Token da API de Conversões
                      <input
                        name="capi_token"
                        type="password"
                        autoComplete="off"
                        placeholder={
                          pixel.has_token
                            ? "Token salvo. Preencha só para trocar."
                            : "Cole o token do Gerenciador de Eventos"
                        }
                      />
                    </label>
                    <label>
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={pixel.active}
                      />{" "}
                      Pixel ativo
                    </label>
                    <label>
                      Modo de envio
                      <select name="mode" defaultValue={pixel.mode}>
                        <option value="api">Só API (servidor)</option>
                        <option value="browser">Só navegador</option>
                        <option value="both">Navegador e API</option>
                        <option value="off">Desligado</option>
                      </select>
                    </label>
                    <label>
                      Código de teste (test_event_code)
                      <input
                        name="test_event_code"
                        defaultValue={pixel.test_event_code ?? ""}
                        placeholder="Opcional, para validar no Gerenciador"
                      />
                    </label>
                    <label>
                      Prefixo do event_id
                      <input
                        name="event_id_prefix"
                        defaultValue={pixel.event_id_prefix}
                      />
                    </label>
                    <fieldset>
                      <legend>Eventos ativos</legend>
                      {eventFields.map(([name, key, label]) => (
                        <label key={name}>
                          <input
                            name={name}
                            type="checkbox"
                            defaultChecked={pixel.settings.events[key]}
                          />{" "}
                          {label}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset>
                      <legend>Correspondência avançada (Purchase)</legend>
                      {matchingFields.map(([name, key, label]) => (
                        <label key={name}>
                          <input
                            name={name}
                            type="checkbox"
                            defaultChecked={pixel.settings.matching[key]}
                          />{" "}
                          {label}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      Valor do Purchase
                      <select
                        name="value_rule"
                        defaultValue={pixel.settings.valueRule}
                      >
                        <option value="paid">Valor pago</option>
                        <option value="full">Preço cheio</option>
                        <option value="fixed">Valor fixo</option>
                        <option value="percent">Percentual do pago</option>
                      </select>
                    </label>
                    <label>
                      Valor fixo (R$)
                      <input
                        name="value_fixed"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={pixel.settings.valueFixed ?? ""}
                      />
                    </label>
                    <label>
                      Percentual (%)
                      <input
                        name="value_percent"
                        type="number"
                        step="0.1"
                        min="0"
                        defaultValue={pixel.settings.valuePercent ?? ""}
                      />
                    </label>
                    <label>
                      content_ids do Purchase
                      <select
                        name="content_ids_type"
                        defaultValue={pixel.settings.contentIdsType}
                      >
                        <option value="product">ID do produto</option>
                        <option value="sku">Código da oferta (SKU)</option>
                        <option value="custom">Personalizado</option>
                      </select>
                    </label>
                    <label>
                      content_ids personalizado
                      <input
                        name="content_ids_custom"
                        defaultValue={pixel.settings.contentIdsCustom ?? ""}
                      />
                    </label>
                    <label>
                      IPs bloqueados (um por linha)
                      <textarea
                        name="block_ips"
                        defaultValue={pixel.settings.blockIps.join("\n")}
                      />
                    </label>
                    {canEdit ? (
                      <button>Salvar pixel do negócio</button>
                    ) : (
                      <p>
                        <small>Somente leitura para o seu papel.</small>
                      </p>
                    )}
                  </form>
                </article>
              ))}
            </section>
          ) : (
            <div className="compact-empty">
              Nenhum projeto de negócio criado. Crie um na tela Projetos para
              configurar o pixel dele.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
