import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "../../../../lib/database";
import { loadProjectR2PreviewConfig } from "../../../../lib/r2-preview";
import { createClient } from "../../../../lib/supabase/server";
import { signOut } from "../../actions";
import { ProjectSwitcher } from "../../project-switcher";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { getActiveProject } from "../../../../lib/active-project";
import {
  approveCreativeVersion,
  requestCreativeAnalysis,
  requestCreativeTranscription,
  requestCreativeTextExtraction,
  rejectCreativeVersion,
  saveCreativeEditorial,
  submitCreativeForReview,
  createPublicationPreview,
  approvePublicationPreview,
  simulatePublication,
  updateCreativePerformanceStatus,
} from "./actions";

export const dynamic = "force-dynamic";

type CreativeDetail = {
  id: string;
  organization_id: string;
  project_id: string;
  project_name: string;
  name: string;
  status: string;
  current_version_id: string | null;
  effective_role: string;
};

type CreativeVersion = {
  id: string;
  version_number: number;
  asset_id: string;
  mime_type: string;
  size_bytes: string;
  malware_status: string;
  content_sha256: string;
  source_modified_at: Date;
  created_at: Date;
  source_file_name: string;
  external_file_id: string;
  folder_name: string;
  drive_status: string;
  available_at: Date | null;
};

type AuditEntry = {
  id: string;
  action: string;
  created_at: Date;
  actor_name: string | null;
  target_id: string | null;
};

type EditorialMetadata = {
  copy_text: string | null;
  headline: string | null;
  cta: string | null;
  destination_url: string | null;
  notes: string | null;
};

type AiSummary = {
  jobs: number;
  pending: number;
  transcripts: number;
  extractions: number;
  analyses: number;
};

type LatestTranscript = {
  text: string;
  language: string | null;
  model: string;
  created_at: Date;
};

type LatestExtraction = {
  text: string;
  method: string;
  model: string | null;
  created_at: Date;
};

type LatestAnalysis = {
  hook: string | null;
  promise: string | null;
  mechanism: string | null;
  proof: unknown;
  objections: unknown;
  cta: string | null;
  structure: unknown;
  performance_hypotheses: unknown;
  evidence: unknown;
  confidence: string;
  model: string;
  prompt_version: string;
  created_at: Date;
};
type MetaPerformance = {
  currency:string|null;ads:number;campaigns:number;spend:string;
  impressions:string;reach:string;clicks:string;last_metric_date:string|null;
};

export default async function CreativeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const active = await getActiveProject(data.user.id);
  if (!active.project) redirect("/dashboard/projetos");

  const database = getDatabase();
  const detailResult = await database.pool.query<CreativeDetail>(
    `select creative.id, creative.organization_id, creative.project_id,
            project.name as project_name, creative.name,
            creative.status::text, creative.current_version_id
            ,coalesce((
              select allowed.role_override::text
                from public.project_memberships allowed
               where allowed.membership_id = membership.id
                 and allowed.project_id = creative.project_id
            ), membership.role::text) as effective_role
       from public.creatives creative
       join public.projects project on project.id = creative.project_id
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = creative.organization_id
        and membership.user_id = app_user.id
      where creative.id = $2 and creative.project_id = $3
        and app_user.status = 'active'
        and (
          not exists (
            select 1 from public.project_memberships restricted
             where restricted.membership_id = membership.id
          )
          or exists (
            select 1 from public.project_memberships allowed
             where allowed.membership_id = membership.id
               and allowed.project_id = creative.project_id
          )
        )
      limit 1`,
    [data.user.id, id, active.project.id],
  );
  const creative = detailResult.rows[0];
  if (!creative) notFound();

  const versions = (
    await database.pool.query<CreativeVersion>(
      `select version.id, version.version_number, version.asset_id,
              asset.mime_type, asset.size_bytes::text, asset.malware_status::text,
              version.content_sha256, version.source_modified_at,
              version.created_at, file.name as source_file_name,
              file.external_file_id, folder.name as folder_name,
              file.status::text as drive_status, asset.available_at
         from public.creative_versions version
         join public.creative_assets asset on asset.id = version.asset_id
         join public.drive_files file on file.id = version.source_drive_file_id
         join public.drive_folders folder on folder.id = file.drive_folder_id
        where version.creative_id = $1
          and version.organization_id = $2
          and version.project_id = $3
        order by version.version_number desc`,
      [creative.id, creative.organization_id, creative.project_id],
    )
  ).rows;
  const versionIds = versions.map((version) => version.id);
  const audit = versionIds.length
    ? (
        await database.pool.query<AuditEntry>(
          `select audit.id, audit.action, audit.occurred_at as created_at,
                  app_user.display_name as actor_name, audit.target_id
             from public.audit_logs audit
             left join public.users app_user on app_user.id = audit.actor_user_id
            where audit.organization_id = $1
              and audit.project_id = $2
              and (
                (audit.target_type = 'creative_version'
                  and audit.target_id = any($3::text[]))
                or (
                  audit.action = 'creative_file_imported'
                  and audit.after->>'creativeId' = $4
                )
              )
            order by audit.occurred_at desc
            limit 100`,
          [
            creative.organization_id,
            creative.project_id,
            versionIds,
            creative.id,
          ],
        )
      ).rows
    : [];

  let previewConfigured = false;
  try {
    previewConfigured = Boolean(
      await loadProjectR2PreviewConfig(database.pool, creative.project_id),
    );
  } catch {
    previewConfigured = false;
  }
  const current =
    versions.find((version) => version.id === creative.current_version_id) ??
    versions[0];
  const metaPerformance=current?(
    await database.pool.query<MetaPerformance>(
      `select account.currency,count(distinct ad.id)::int ads,
              count(distinct ad.meta_campaign_id)::int campaigns,
              coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
              coalesce(sum(insight.impressions),0)::text impressions,
              coalesce(sum(insight.reach),0)::text reach,
              coalesce(sum(insight.clicks),0)::text clicks,
              max(insight.metric_date)::text last_metric_date
         from public.creative_ad_links link
         join public.meta_ads ad on ad.id=link.meta_ad_id
         join public.meta_ad_accounts account on account.id=ad.meta_ad_account_id
         left join public.meta_ad_insights_daily insight on insight.meta_ad_id=ad.id
          and insight.metric_date>=current_date-29
        where link.creative_version_id=$1 and link.project_id=$2
        group by account.currency
        order by coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0) desc`,
      [current.id,creative.project_id],
    )
  ).rows:[];
  const previewUrl = current
    ? `/dashboard/criativos/assets/${current.asset_id}`
    : null;
  const editorial = current
    ? (
        await database.pool.query<EditorialMetadata>(
          `select copy_text, headline, cta, destination_url, notes
             from public.creative_editorial_metadata
            where creative_id = $1 and creative_version_id = $2
            limit 1`,
          [creative.id, current.id],
        )
      ).rows[0]
    : undefined;
  const metaTargets = (
    await database.pool.query<{
      connection_id:string;account_id:string;account_name:string;currency:string;
      campaign_id:string;campaign_name:string;ad_set_id:string;ad_set_name:string;
    }>(
      `select account.connection_id,account.external_id account_id,account.name account_name,
       account.currency,campaign.external_id campaign_id,campaign.name campaign_name,
       ad_set.external_id ad_set_id,ad_set.name ad_set_name
       from public.meta_ad_accounts account
       join public.connections connection on connection.id=account.connection_id and connection.status='active'
       join public.meta_campaigns campaign on campaign.meta_ad_account_id=account.id
       join public.meta_ad_sets ad_set on ad_set.meta_campaign_id=campaign.id
       where account.project_id=$1 order by account.name,campaign.name,ad_set.name`,
      [creative.project_id],
    )
  ).rows;
  const latestPublication = current ? (
    await database.pool.query<{
      request_id:string;preview_id:string;status:string;snapshot:Record<string,unknown>;
      snapshot_sha256:string;generated_at:Date;
    }>(
      `select request.id request_id,preview.id preview_id,request.status::text,
       preview.snapshot,preview.snapshot_sha256,preview.generated_at
       from public.creative_publication_requests request
       join public.creative_publication_previews preview
         on preview.publication_request_id=request.id
       where request.creative_id=$1 and request.creative_version_id=$2
       order by preview.generated_at desc limit 1`,
      [creative.id,current.id],
    )
  ).rows[0] : undefined;
  const publicationExecution=latestPublication?(
    await database.pool.query<{status:string;mode:string;finished_at:Date|null;
      last_error_sanitized:string|null}>(
      `select status::text,mode,finished_at,last_error_sanitized
       from public.meta_publication_executions
       where publication_request_id=$1 order by created_at desc limit 1`,
      [latestPublication.request_id])
  ).rows[0]:undefined;
  const manualTags = current
    ? (
        await database.pool.query<{ name: string }>(
          `select tag.name
             from public.creative_tag_assignments assignment
             join public.creative_tags tag on tag.id = assignment.tag_id
            where assignment.creative_version_id = $1
              and assignment.source = 'manual'
              and assignment.removed_at is null
            order by tag.normalized_name`,
          [current.id],
        )
      ).rows.map((tag) => tag.name)
    : [];
  const aiTags = current
    ? (
        await database.pool.query<{ name: string; confidence: string }>(
          `select tag.name, assignment.confidence::text
             from public.creative_tag_assignments assignment
             join public.creative_tags tag on tag.id = assignment.tag_id
            where assignment.creative_version_id = $1
              and assignment.source = 'ai'
              and assignment.removed_at is null
            order by assignment.confidence desc, tag.normalized_name`,
          [current.id],
        )
      ).rows
    : [];
  const canEdit = ["owner", "administrator", "editor"].includes(
    creative.effective_role,
  );
  const aiSummary = current
    ? (
        await database.pool.query<AiSummary>(
          `select
             (select count(*)::int from public.creative_ai_jobs
               where creative_version_id = $1) as jobs,
             (select count(*)::int from public.creative_ai_jobs
               where creative_version_id = $1
                 and status in ('pending', 'processing', 'failed_retryable')) as pending,
             (select count(*)::int from public.creative_transcripts
               where creative_version_id = $1) as transcripts,
             (select count(*)::int from public.creative_text_extractions
               where creative_version_id = $1) as extractions,
             (select count(*)::int from public.creative_analyses
               where creative_version_id = $1) as analyses`,
          [current.id],
        )
      ).rows[0]
    : undefined;
  const aiConfigured = Boolean(
    current &&
      (
        await database.pool.query(
          `select 1 from public.connections
            where project_id = $1 and provider = 'openai'
              and status = 'active'
              and nullif(configuration->>'transcriptionModel', '') is not null
            limit 1`,
          [creative.project_id],
        )
      ).rowCount,
  );
  const latestTranscript = current
    ? (
        await database.pool.query<LatestTranscript>(
          `select text, language, model, created_at
             from public.creative_transcripts
            where creative_version_id = $1
            order by created_at desc limit 1`,
          [current.id],
        )
      ).rows[0]
    : undefined;
  const latestExtraction = current
    ? (
        await database.pool.query<LatestExtraction>(
          `select text, method, model, created_at
             from public.creative_text_extractions
            where creative_version_id = $1
            order by created_at desc limit 1`,
          [current.id],
        )
      ).rows[0]
    : undefined;
  const latestAnalysis = current
    ? (
        await database.pool.query<LatestAnalysis>(
          `select hook, promise, mechanism, proof, objections, cta, structure,
                  performance_hypotheses, evidence, confidence::text, model,
                  prompt_version, created_at
             from public.creative_analyses
            where creative_version_id = $1
            order by created_at desc limit 1`,
          [current.id],
        )
      ).rows[0]
    : undefined;

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/criativos" footerLabel="Histórico preservado" />

      <section className="app-content">
        <header className="app-topbar">
          <ProjectSwitcher returnTo={`/dashboard/criativos/${creative.id}`} />
          <div className="topbar-actions">
            <Link className="icon-button" href="/dashboard/criativos">
              Voltar
            </Link>
            <form action={signOut}>
              <button className="icon-button" type="submit">
                Sair
              </button>
            </form>
          </div>
        </header>

        <div className="dashboard-main">
          {query.status === "saved" ? (
            <div className="notice notice-success">
              Informações editoriais salvas e registradas na auditoria.
            </div>
          ) : null}
          {query.status === "invalid-url" ? (
            <div className="notice notice-error">
              O destino deve ser uma URL HTTPS válida.
            </div>
          ) : null}
          {query.status === "forbidden" ? (
            <div className="notice notice-error">
              Seu papel não permite editar este criativo.
            </div>
          ) : null}
          {query.status === "save-failed" ? (
            <div className="notice notice-error">
              Não foi possível salvar. Os dados anteriores foram preservados.
            </div>
          ) : null}
          {query.status === "transcription-queued" ? (
            <div className="notice notice-success">
              Transcrição adicionada à fila e vinculada a esta versão.
            </div>
          ) : null}
          {query.status === "analysis-queued" ? (
            <div className="notice notice-success">
              Análise adicionada à fila e vinculada a esta versão.
            </div>
          ) : null}
          {query.status === "extraction-queued" ? (
            <div className="notice notice-success">
              Extração de texto adicionada à fila para esta versão.
            </div>
          ) : null}
          {query.status?.startsWith("ai-") ? (
            <div className="notice notice-error">
              Não foi possível solicitar a transcrição. Verifique integração,
              permissão e disponibilidade segura do vídeo.
            </div>
          ) : null}
          {query.status === "review-requested" ? (
            <div className="notice notice-success">Versão enviada para aprovação.</div>
          ) : null}
          {query.status === "approved" ? (
            <div className="notice notice-success">Versão aprovada e registrada.</div>
          ) : null}
          {query.status === "rejected" ? (
            <div className="notice notice-success">
              Versão devolvida para ajustes com histórico preservado.
            </div>
          ) : null}
          {query.status === "simulation-completed" ? (
            <div className="notice notice-success">
              Simulação reconciliada sem escrita externa.
            </div>
          ) : null}
          {query.status === "reconciliation-required" ? (
            <div className="notice notice-error">
              A simulação encontrou divergência. Nenhum dado foi enviado à Meta.
            </div>
          ) : null}
          {query.status === "performance-status-updated" ? (
            <div className="notice notice-success">
              Classificação de desempenho atualizada sem alterar anúncios externos.
            </div>
          ) : null}
          {query.status !== "performance-status-updated" &&
           (query.status?.includes("performance-status") ||
            query.status === "invalid-performance-status") ? (
            <div className="notice notice-error">
              Não foi possível atualizar a classificação. Verifique estado, vínculo, permissão e justificativa.
            </div>
          ) : null}
          {["review-invalid","analysis-required","review-failed"].includes(query.status ?? "") ? (
            <div className="notice notice-error">
              Não foi possível concluir a revisão. A versão precisa estar analisada
              e em um estado compatível.
            </div>
          ) : null}
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Detalhe e histórico</p>
              <h1>{creative.name}</h1>
              <p className="dashboard-context">
                Versões, origem, integridade e auditoria do criativo.
              </p>
            </div>
            <span className="creative-detail-status">{creative.status}</span>
          </header>

          {!current ? (
            <div className="notice notice-error">
              Este criativo ainda não possui uma versão disponível.
            </div>
          ) : (
            <section className="creative-detail-grid">
              <article className="creative-detail-preview">
                <div className="creative-preview">
                  {previewConfigured &&
                  current.mime_type.startsWith("image/") &&
                  previewUrl ? (
                    <Image
                      alt={`Prévia de ${creative.name}`}
                      fill
                      priority
                      sizes="(max-width: 900px) 100vw, 55vw"
                      src={previewUrl}
                      unoptimized
                    />
                  ) : previewConfigured &&
                    current.mime_type.startsWith("video/") &&
                    previewUrl ? (
                    <video controls preload="metadata">
                      <source src={previewUrl} type={current.mime_type} />
                    </video>
                  ) : (
                    <div className="creative-file-placeholder">
                      <span>▦</span>
                      <small>
                        {previewConfigured
                          ? "Documento sem renderização visual"
                          : "Prévia privada indisponível"}
                      </small>
                    </div>
                  )}
                </div>
              </article>

              <article className="creative-detail-facts">
                <p className="panel-label">Versão atual</p>
                <h2>Versão {current.version_number}</h2>
                <dl>
                  <div>
                    <dt>Arquivo de origem</dt>
                    <dd>{current.source_file_name}</dd>
                  </div>
                  <div>
                    <dt>Pasta</dt>
                    <dd>{current.folder_name}</dd>
                  </div>
                  <div>
                    <dt>Tipo</dt>
                    <dd>{current.mime_type}</dd>
                  </div>
                  <div>
                    <dt>Tamanho</dt>
                    <dd>
                      {(Number(current.size_bytes) / 1024 / 1024).toFixed(2)} MB
                    </dd>
                  </div>
                  <div>
                    <dt>Antimalware</dt>
                    <dd>{current.malware_status}</dd>
                  </div>
                  <div>
                    <dt>Origem no Drive</dt>
                    <dd>{current.drive_status}</dd>
                  </div>
                  <div>
                    <dt>SHA-256</dt>
                    <dd>
                      <code>
                        {current.content_sha256.slice(0, 12)}…
                        {current.content_sha256.slice(-8)}
                      </code>
                    </dd>
                  </div>
                </dl>
              </article>
            </section>
          )}

          {current?.mime_type.startsWith("video/") ? (
            <section className="creative-editorial-section">
              <div className="section-heading">
                <div>
                  <p className="panel-label">Inteligência assistida</p>
                  <h2>Processar esta versão</h2>
                </div>
                <span>{aiConfigured ? "disponível" : "configuração pendente"}</span>
              </div>
              {!aiConfigured ? (
                <div className="permission-state">
                  <strong>Integração OpenAI indisponível</strong>
                  <p>Revise a chave e os modelos em Integrações.</p>
                </div>
              ) : !canEdit ? (
                <div className="permission-state">
                  <strong>Sem permissão para processar</strong>
                  <p>É necessário papel de owner, administrador ou editor.</p>
                </div>
              ) : latestTranscript ? (
                <div className="method-note">
                  <strong>Transcrição concluída</strong>
                  <p>O resultado está preservado nesta versão.</p>
                  {!latestAnalysis ? (
                    <form action={requestCreativeAnalysis}>
                      <input name="creative_id" type="hidden" value={creative.id} />
                      <input name="version_id" type="hidden" value={current.id} />
                      <button
                        className="primary-button"
                        disabled={Boolean(aiSummary?.pending)}
                        type="submit"
                      >
                        {aiSummary?.pending
                          ? "Processamento em andamento"
                          : "Analisar esta versão"}
                      </button>
                    </form>
                  ) : (
                    <p>Análise concluída e disponível abaixo.</p>
                  )}
                </div>
              ) : (
                <form action={requestCreativeTranscription}>
                  <input name="creative_id" type="hidden" value={creative.id} />
                  <input name="version_id" type="hidden" value={current.id} />
                  <button
                    className="primary-button"
                    disabled={Boolean(aiSummary?.pending)}
                    type="submit"
                  >
                    {aiSummary?.pending
                      ? "Transcrição em processamento"
                      : "Transcrever esta versão"}
                  </button>
                </form>
              )}
            </section>
          ) : null}

          {current && latestAnalysis ? (
            <section className="creative-editorial-section">
              <div className="section-heading">
                <div>
                  <p className="panel-label">Revisão humana</p>
                  <h2>Aprovação da versão {current.version_number}</h2>
                </div>
                <span>{creative.status}</span>
              </div>
              {creative.status === "awaiting_approval" &&
              ["owner","administrator"].includes(creative.effective_role) ? (
                <form action={approveCreativeVersion} className="editorial-form">
                  <input name="creative_id" type="hidden" value={creative.id} />
                  <input name="version_id" type="hidden" value={current.id} />
                  <label>Observação da aprovação
                    <textarea name="reason" placeholder="Critérios conferidos e observações" />
                  </label>
                  <button className="primary-button" type="submit">
                    Aprovar esta versão
                  </button>
                  <button
                    className="icon-button"
                    formAction={rejectCreativeVersion}
                    type="submit"
                  >
                    Rejeitar e devolver
                  </button>
                </form>
              ) : ["imported","analyzing"].includes(creative.status) && canEdit ? (
                <form action={submitCreativeForReview} className="editorial-form">
                  <input name="creative_id" type="hidden" value={creative.id} />
                  <input name="version_id" type="hidden" value={current.id} />
                  <label>Observação para revisão
                    <textarea name="reason" placeholder="O que deve ser conferido" />
                  </label>
                  <button className="primary-button" type="submit">
                    Enviar para aprovação
                  </button>
                </form>
              ) : creative.status === "approved" ? (
                <div>
                <div className="method-note">
                  <strong>Versão aprovada</strong>
                  <p>A aprovação está vinculada somente a esta versão.</p>
                </div>
                {metaTargets.length ? <form action={createPublicationPreview} className="editorial-form">
                  <input name="creative_id" type="hidden" value={creative.id}/>
                  <input name="version_id" type="hidden" value={current.id}/>
                  <label>Conexão Meta
                    <select name="connection_id" required>{[...new Map(metaTargets.map(t=>[t.connection_id,t])).values()].map(t=>
                      <option key={t.connection_id} value={t.connection_id}>{t.account_name}</option>)}</select>
                  </label>
                  <label>Conta
                    <select name="account_id" required>{[...new Map(metaTargets.map(t=>[t.account_id,t])).values()].map(t=>
                      <option key={t.account_id} value={t.account_id}>{t.account_name} · {t.currency}</option>)}</select>
                  </label>
                  <label>Campanha<select name="campaign_id" required>{[...new Map(metaTargets.map(t=>[t.campaign_id,t])).values()].map(t=>
                    <option key={t.campaign_id} value={t.campaign_id}>{t.campaign_name}</option>)}</select></label>
                  <label>Conjunto<select name="ad_set_id" required>{metaTargets.map(t=>
                    <option key={t.ad_set_id} value={t.ad_set_id}>{t.ad_set_name}</option>)}</select></label>
                  <label>Destino HTTPS<input name="destination_url" required defaultValue={editorial?.destination_url??""}/></label>
                  <label>Orçamento diário<input name="daily_budget" required min="1" step="0.01" type="number"/></label>
                  <button className="primary-button" type="submit">Gerar prévia imutável</button>
                  <small>Nenhum anúncio será enviado. A prévia exige aprovação específica.</small>
                </form>:<div className="empty-state"><strong>Catálogo Meta indisponível</strong><p>Sincronize uma conexão antes de preparar a publicação.</p></div>}
                </div>
              ) : (
                <div className="permission-state">
                  <strong>Aguardando aprovação</strong>
                  <p>Somente owner ou administrador pode aprovar.</p>
                </div>
              )}
            </section>
          ) : null}

          {latestPublication ? <section className="creative-editorial-section">
            <div className="section-heading"><div><p className="panel-label">Prévia de publicação</p><h2>Conferência final</h2></div><span>{latestPublication.status}</span></div>
            <div className="method-note">
              <p><strong>Conta:</strong> {String(latestPublication.snapshot.accountName??latestPublication.snapshot.accountId??"")}</p>
              <p><strong>Campanha:</strong> {String(latestPublication.snapshot.campaignName??"")}</p>
              <p><strong>Conjunto:</strong> {String(latestPublication.snapshot.adSetName??"")}</p>
              <p><strong>Destino:</strong> {String(latestPublication.snapshot.destinationUrl??"")}</p>
              <p><strong>Orçamento:</strong> {String(latestPublication.snapshot.currency??"BRL")} {String(latestPublication.snapshot.dailyBudget??"")}/dia</p>
              <small>SHA-256: {latestPublication.snapshot_sha256}</small>
            </div>
            {latestPublication.status==="preview_ready" &&
            ["owner","administrator"].includes(creative.effective_role) ? <form action={approvePublicationPreview}>
              <input type="hidden" name="creative_id" value={creative.id}/>
              <input type="hidden" name="publication_request_id" value={latestPublication.request_id}/>
              <input type="hidden" name="publication_preview_id" value={latestPublication.preview_id}/>
              <input type="hidden" name="snapshot_sha256" value={latestPublication.snapshot_sha256}/>
              <button className="primary-button" type="submit">Aprovar exatamente esta prévia</button>
              <small>A aprovação não envia o anúncio. Ela somente libera a futura etapa assistida.</small>
            </form>:null}
            {latestPublication.status==="action_approved" && !publicationExecution &&
            ["owner","administrator"].includes(creative.effective_role)?<form action={simulatePublication}>
              <input type="hidden" name="creative_id" value={creative.id}/>
              <input type="hidden" name="publication_request_id" value={latestPublication.request_id}/>
              <button className="primary-button" type="submit">Executar simulação segura</button>
            </form>:null}
            {publicationExecution?<div className={`notice ${
              publicationExecution.status==="simulation_completed"
                ?"notice-success":"notice-error"}`}>
              Simulação sem escrita externa. Estado: {publicationExecution.status}.
              {publicationExecution.last_error_sanitized
                ?` Conferir: ${publicationExecution.last_error_sanitized}.`:""}
            </div>:null}
          </section>:null}

          {metaPerformance.length?<section className="creative-editorial-section">
            <div className="section-heading"><div><p className="panel-label">Meta Ads · últimos 30 dias</p>
              <h2>Desempenho desta versão</h2></div>
              <Link href="/dashboard/campanhas/criativos">Ver ranking completo</Link></div>
            <div className="integration-config-grid">{metaPerformance.map((item)=>{
              const spend=Number(item.spend),impressions=Number(item.impressions),clicks=Number(item.clicks);
              const currency=item.currency||"BRL";
              const money=(value:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency}).format(value);
              return <article className="integration-config-card" key={currency}>
                <div><p className="panel-label">{currency}</p><span className="configured">{item.ads} anúncio(s)</span></div>
                <p><strong>{money(spend)}</strong> investidos</p>
                <p>{impressions.toLocaleString("pt-BR")} impressões · {clicks.toLocaleString("pt-BR")} cliques</p>
                <p>CTR: {impressions?`${(clicks/impressions*100).toFixed(2)}%`:"—"} · CPC: {clicks?money(spend/clicks):"—"}</p>
                <small>{item.campaigns} campanha(s) · dados até {item.last_metric_date??"data não informada"}</small>
              </article>;
            })}</div>
            <div className="method-note"><strong>Resultado observado, não causal</strong>
              <p>As métricas pertencem aos anúncios ligados a esta versão. O painel não atribui vendas nem afirma que o criativo causou o desempenho.</p></div>
            {canEdit?<form action={requestCreativeAnalysis}>
              <input name="creative_id" type="hidden" value={creative.id}/>
              <input name="version_id" type="hidden" value={current!.id}/>
              <button className="primary-button" disabled={Boolean(aiSummary?.pending)} type="submit">
                {aiSummary?.pending?"Processamento em andamento":"Analisar conteúdo com desempenho observado"}
              </button>
            </form>:null}
            {canEdit&&["approved","ready_to_publish","published","paused","winner","fatigued"].includes(creative.status)?
              <form action={updateCreativePerformanceStatus} className="editorial-form">
                <input name="creative_id" type="hidden" value={creative.id}/>
                <input name="version_id" type="hidden" value={current!.id}/>
                <label>Classificação humana
                  <select defaultValue={creative.status==="approved"?"published":creative.status} name="status">
                    <option value="published">Publicado</option><option value="winner">Vencedor</option>
                    <option value="fatigued">Em fadiga</option><option value="paused">Pausado</option>
                    <option value="archived">Arquivado</option>
                  </select>
                </label>
                <label>Justificativa<textarea name="reason" placeholder="Evidências e contexto usados na decisão" required/></label>
                <button type="submit">Registrar classificação</button>
                <small>Esta ação atualiza somente o status interno; não pausa nem altera anúncios na Meta.</small>
              </form>:null}
          </section>:null}

          <section className="creative-version-history">
            <div className="section-heading">
              <div>
                <p className="panel-label">Versionamento</p>
                <h2>Histórico de versões</h2>
              </div>
              <span>{versions.length} versão(ões)</span>
            </div>
            {versions.length ? (
              <div className="version-list">
                {versions.map((version) => (
                  <article
                    className={
                      version.id === creative.current_version_id
                        ? "current"
                        : undefined
                    }
                    key={version.id}
                  >
                    <div>
                      <strong>Versão {version.version_number}</strong>
                      <small>
                        {version.source_file_name} · {version.mime_type}
                      </small>
                    </div>
                    <div>
                      <span>{version.malware_status}</span>
                      <time dateTime={version.created_at.toISOString()}>
                        {version.created_at.toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })}
                      </time>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="method-note">
                <strong>Sem versões</strong>
                <p>Nenhuma versão foi persistida para este criativo.</p>
              </div>
            )}
          </section>

          <section className="creative-editorial-section">
            <div className="section-heading">
              <div>
                <p className="panel-label">Preparação editorial</p>
                <h2>Copy, destino e tags</h2>
              </div>
              <span>Versão {current?.version_number ?? "—"}</span>
            </div>
            {!current ? (
              <div className="method-note">
                <strong>Versão necessária</strong>
                <p>Importe uma versão antes de preencher os metadados.</p>
              </div>
            ) : canEdit ? (
              <form action={saveCreativeEditorial} className="editorial-form">
                <input name="creative_id" type="hidden" value={creative.id} />
                <input name="version_id" type="hidden" value={current.id} />
                <label>
                  Headline
                  <input
                    defaultValue={editorial?.headline ?? ""}
                    maxLength={500}
                    name="headline"
                    placeholder="Título principal usado com o criativo"
                  />
                </label>
                <label>
                  CTA
                  <input
                    defaultValue={editorial?.cta ?? ""}
                    maxLength={200}
                    name="cta"
                    placeholder="Ex.: Saiba mais"
                  />
                </label>
                <label className="editorial-wide">
                  Copy
                  <textarea
                    defaultValue={editorial?.copy_text ?? ""}
                    maxLength={20000}
                    name="copy_text"
                    placeholder="Texto principal do anúncio ou peça"
                    rows={6}
                  />
                </label>
                <label className="editorial-wide">
                  Destino HTTPS
                  <input
                    defaultValue={editorial?.destination_url ?? ""}
                    maxLength={2000}
                    name="destination_url"
                    placeholder="https://..."
                    type="url"
                  />
                </label>
                <label className="editorial-wide">
                  Tags manuais
                  <input
                    defaultValue={manualTags.join(", ")}
                    maxLength={2000}
                    name="tags"
                    placeholder="ugc, depoimento, oferta, remarketing"
                  />
                  <small>Separe até 30 tags por vírgulas.</small>
                </label>
                <div className="editorial-wide">
                  <span>Tags sugeridas pela IA</span>
                  {aiTags.length ? (
                    <div className="product-tags">
                      {aiTags.map((tag) => (
                        <span key={tag.name}>
                          {tag.name} · {Math.round(Number(tag.confidence) * 100)}%
                        </span>
                      ))}
                    </div>
                  ) : (
                    <small>Nenhuma tag automática nesta versão.</small>
                  )}
                  <small>
                    Sugestões automáticas não substituem as tags manuais.
                  </small>
                </div>
                <label className="editorial-wide">
                  Observações internas
                  <textarea
                    defaultValue={editorial?.notes ?? ""}
                    maxLength={10000}
                    name="notes"
                    placeholder="Contexto, hipóteses e orientações para revisão"
                    rows={4}
                  />
                </label>
                <div className="editorial-wide editorial-submit">
                  <p>
                    As alterações afetam somente esta versão e ficam registradas
                    com usuário, instante, antes e depois.
                  </p>
                  <button type="submit">Salvar informações editoriais</button>
                </div>
              </form>
            ) : (
              <div className="permission-state">
                <strong>Somente leitura</strong>
                <p>
                  Proprietário, administrador ou editor pode alterar estes
                  campos.
                </p>
              </div>
            )}
          </section>

          <section className="creative-editorial-section">
            <div className="section-heading">
              <div>
                <p className="panel-label">Inteligência assistida</p>
                <h2>Transcrição, texto e análise</h2>
              </div>
              <span>{aiConfigured ? "configurada" : "desativada"}</span>
            </div>
            <div className="creative-ai-summary">
              <article><strong>{aiSummary?.transcripts ?? 0}</strong><span>Transcrições</span></article>
              <article><strong>{aiSummary?.extractions ?? 0}</strong><span>Extrações</span></article>
              <article><strong>{aiSummary?.analyses ?? 0}</strong><span>Análises</span></article>
              <article><strong>{aiSummary?.pending ?? 0}</strong><span>Em processamento</span></article>
            </div>
            {!aiConfigured ? (
              <div className="permission-state">
                <strong>Processamento de IA bloqueado com segurança</strong>
                <p>
                  A fila e os resultados versionados estão prontos. Nenhum
                  conteúdo será enviado até chave, modelo, orçamento e worker
                  serem configurados.
                </p>
              </div>
            ) : (
              <div className="method-note">
                <strong>Infraestrutura disponível</strong>
                <p>
                  O envio é manual, versionado e não publica o criativo.
                </p>
                {current?.mime_type.startsWith("video/") && canEdit ? (
                  <form action={requestCreativeTranscription}>
                    <input name="creative_id" type="hidden" value={creative.id} />
                    <input name="version_id" type="hidden" value={current.id} />
                    <button
                      className="primary-button"
                      disabled={Boolean(aiSummary?.pending || latestTranscript)}
                      type="submit"
                    >
                      {latestTranscript
                        ? "Transcrição concluída"
                        : aiSummary?.pending
                          ? "Transcrição em processamento"
                          : "Transcrever esta versão"}
                    </button>
                  </form>
                ) : current && canEdit && [
                  "text/plain",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ].includes(current.mime_type) ? (
                  <form action={requestCreativeTextExtraction}>
                    <input name="creative_id" type="hidden" value={creative.id} />
                    <input name="version_id" type="hidden" value={current.id} />
                    <button
                      className="primary-button"
                      disabled={Boolean(aiSummary?.pending || latestExtraction)}
                      type="submit"
                    >
                      {latestExtraction
                        ? "Texto extraído"
                        : aiSummary?.pending
                          ? "Extração em processamento"
                          : "Extrair texto desta versão"}
                    </button>
                  </form>
                ) : (
                  <p>Esta ação exige vídeo disponível e papel de edição.</p>
                )}
              </div>
            )}
            {latestTranscript ? (
              <>
              <details className="ai-result-block">
                <summary>
                  <span>Transcrição</span>
                  <small>
                    {latestTranscript.language ?? "idioma não informado"} ·{" "}
                    {latestTranscript.model}
                  </small>
                </summary>
                <p className="ai-long-text">{latestTranscript.text}</p>
              </details>
              {canEdit && !latestAnalysis ? (
                <form action={requestCreativeAnalysis}>
                  <input name="creative_id" type="hidden" value={creative.id} />
                  <input name="version_id" type="hidden" value={current?.id} />
                  <button
                    className="primary-button"
                    disabled={Boolean(aiSummary?.pending)}
                    type="submit"
                  >
                    {aiSummary?.pending
                      ? "Processamento em andamento"
                      : "Analisar esta versão"}
                  </button>
                </form>
              ) : null}
              </>
            ) : null}
            {latestExtraction ? (
              <details className="ai-result-block">
                <summary>
                  <span>Texto extraído</span>
                  <small>
                    {latestExtraction.method}
                    {latestExtraction.model
                      ? ` · ${latestExtraction.model}`
                      : ""}
                  </small>
                </summary>
                <p className="ai-long-text">{latestExtraction.text}</p>
              </details>
            ) : null}
            {latestAnalysis ? (
              <div className="ai-analysis-result">
                <div className="ai-analysis-header">
                  <div>
                    <strong>Análise estruturada</strong>
                    <small>
                      {latestAnalysis.model} · prompt{" "}
                      {latestAnalysis.prompt_version}
                    </small>
                  </div>
                  <span>
                    {(Number(latestAnalysis.confidence) * 100).toFixed(0)}%
                    confiança
                  </span>
                </div>
                <div className="ai-analysis-grid">
                  <article>
                    <small>Gancho</small>
                    <p>{latestAnalysis.hook ?? "Não identificado"}</p>
                  </article>
                  <article>
                    <small>Promessa</small>
                    <p>{latestAnalysis.promise ?? "Não identificada"}</p>
                  </article>
                  <article>
                    <small>Mecanismo</small>
                    <p>{latestAnalysis.mechanism ?? "Não identificado"}</p>
                  </article>
                  <article>
                    <small>CTA</small>
                    <p>{latestAnalysis.cta ?? "Não identificado"}</p>
                  </article>
                </div>
                <details className="ai-result-block">
                  <summary>
                    <span>Evidências e estrutura</span>
                    <small>resultado técnico versionado</small>
                  </summary>
                  <pre>
                    {JSON.stringify(
                      {
                        proof: latestAnalysis.proof,
                        objections: latestAnalysis.objections,
                        structure: latestAnalysis.structure,
                        performanceHypotheses:
                          latestAnalysis.performance_hypotheses,
                        evidence: latestAnalysis.evidence,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <div className="method-note">
                  <strong>Revisão humana obrigatória</strong>
                  <p>
                    Este resultado é uma hipótese assistida. Não altera status,
                    aprovação ou publicação do criativo.
                  </p>
                </div>
              </div>
            ) : null}
          </section>

          <section className="creative-version-history">
            <div className="section-heading">
              <div>
                <p className="panel-label">Auditoria</p>
                <h2>Linha do tempo</h2>
              </div>
            </div>
            {audit.length ? (
              <div className="audit-timeline">
                {audit.map((entry) => (
                  <article key={entry.id}>
                    <i aria-hidden="true" />
                    <div>
                      <strong>{entry.action.replaceAll("_", " ")}</strong>
                      <small>
                        {entry.actor_name ?? "Processamento do sistema"} ·{" "}
                        {entry.created_at.toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="method-note">
                <strong>Sem eventos adicionais</strong>
                <p>A versão permanece registrada mesmo sem eventos posteriores.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
