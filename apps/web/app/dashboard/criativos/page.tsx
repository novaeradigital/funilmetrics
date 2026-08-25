import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import {
  loadProjectGoogleOAuthConfig,
  loadProjectGooglePickerConfig,
} from "../../../lib/google-drive-runtime";
import { DriveFolderPicker } from "./drive-folder-picker";
import { DriveInventoryButton } from "./drive-inventory-button";
import { DriveImportButton } from "./drive-import-button";
import { loadProjectR2PreviewConfig } from "../../../lib/r2-preview";
import { creativeImportReadiness } from "../../../lib/creative-import-readiness";
import { saveDriveSyncSchedule } from "./sync-actions";
import {getActiveProject} from "../../../lib/active-project";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";

export const dynamic = "force-dynamic";

type CreativeSummary = {
  project_id: string;
  project_name: string;
  role: string;
  connections: number;
  folders: number;
  files: number;
  assets: number;
  creatives: number;
  pending_jobs: number;
  failed_jobs: number;
  drive_connection_id: string | null;
  drive_account_email: string | null;
  drive_granted_scopes: string[] | null;
};

type AuthorizedFolder = {
  id: string;
  name: string;
  include_subfolders: boolean;
  status: string;
  sync_enabled: boolean;
  interval_minutes: number;
  next_run_at: Date|null;
  last_run_at: Date|null;
};

type InventoryJob = {
  id: string;
  drive_folder_id: string;
  folder_name: string;
  status: string;
  files_detected: number;
  error_code: string | null;
  created_at: Date;
  pending_items: number;
};

type CreativeLibraryItem = {
  id: string;
  name: string;
  status: string;
  version_id: string;
  version_number: number;
  asset_id: string;
  mime_type: string;
  size_bytes: string;
  source_modified_at: Date;
  folder_name: string;
  total_count: string;
};

const driveOAuthErrorMessages: Record<string, string> = {
  "oauth-invalid": "A autorização do Google expirou ou não corresponde a esta sessão. Inicie novamente.",
  "oauth-not-configured": "As credenciais OAuth do Google Drive estão incompletas neste projeto.",
  "oauth-exchange-unavailable": "O Google não respondeu a tempo. Inicie uma nova conexão.",
  "oauth-exchange-failed": "O Google recusou a troca do código de autorização.",
  "oauth-exchange-invalid": "O Google devolveu uma resposta de autorização inválida.",
  "oauth-scope-missing": "A conta não concedeu a permissão de leitura necessária do Google Drive.",
  "oauth-identity-unavailable": "O Google não respondeu ao validar a identidade conectada.",
  "oauth-identity-failed": "Não foi possível validar a identidade conectada ao Google.",
  "oauth-identity-invalid": "O Google devolveu dados de identidade inválidos.",
  "oauth-persistence-failed": "A autorização foi validada, mas não pôde ser salva com segurança.",
};

const driveImportErrorMessages: Record<string, string> = {
  execution_file_limit_exceeded:
    "Limite de 1.000 arquivos por execução excedido. Selecione uma pasta ou lote menor.",
  execution_size_limit_exceeded:
    "Limite de 20 GB por execução excedido. Selecione uma pasta ou lote menor.",
  drive_authorization_unavailable:
    "A autorização do Google Drive não está disponível.",
  drive_inventory_failed:
    "O inventário não pôde ser concluído.",
};
type DriveChangeItem = {
  id:string;folder_name:string;file_name:string|null;external_file_id:string;
  change_type:string;observed_at:Date;
};

type PageProps = {
  searchParams: Promise<{
    status?: string; q?: string; creative_status?: string;
    media_type?: string; folder?: string; page?: string;
  }>;
};

export default async function CreativesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search=(params.q??"").trim().slice(0,120);
  const creativeStatus=(params.creative_status??"").slice(0,40);
  const mediaType=["image","video","text","document"].includes(params.media_type??"")
    ? params.media_type??"" : "";
  const folderFilter=/^[0-9a-f-]{36}$/i.test(params.folder??"")?params.folder??"":"";
  const page=Math.max(1,Math.min(1000,Number(params.page)||1));
  const pageSize=24;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");

  const database = getDatabase();
  const result = await database.pool.query<CreativeSummary>(
    `with accessible_project as (
       select project.id, project.name, membership.role::text
         from public.projects project
         join public.users app_user on app_user.auth_user_id = $1
         join public.memberships membership
           on membership.organization_id = project.organization_id
          and membership.user_id = app_user.id
        where app_user.status = 'active' and project.id=$2
          and (
            not exists (
              select 1 from public.project_memberships restricted
               where restricted.membership_id = membership.id
            )
            or exists (
              select 1 from public.project_memberships allowed
               where allowed.membership_id = membership.id
                 and allowed.project_id = project.id
            )
          )
        order by project.created_at
        limit 1
     )
     select project.id as project_id, project.name as project_name, project.role,
            (select count(*)::int from public.drive_connections item where item.project_id = project.id) as connections,
            (select count(*)::int from public.drive_folders item where item.project_id = project.id) as folders,
            (select count(*)::int from public.drive_files item where item.project_id = project.id) as files,
            (select count(*)::int from public.creative_assets item where item.project_id = project.id) as assets,
            (select count(*)::int from public.creatives item where item.project_id = project.id) as creatives,
            (select count(*)::int from public.drive_import_jobs item
              where item.project_id = project.id
                and item.status in ('pending', 'inventorying', 'importing')) as pending_jobs,
            (select count(*)::int from public.drive_import_jobs item
              where item.project_id = project.id
                and item.status in ('failed', 'completed_with_errors')
                and not exists (
                  select 1 from public.drive_import_jobs newer
                   where newer.drive_folder_id = item.drive_folder_id
                     and newer.created_at > item.created_at
                     and newer.status in ('pending', 'inventorying', 'importing',
                                          'completed', 'completed_with_errors')
                )) as failed_jobs,
            (select item.id from public.drive_connections item
              where item.project_id = project.id and item.disconnected_at is null
              order by item.updated_at desc limit 1) as drive_connection_id,
            (select item.account_email from public.drive_connections item
              where item.project_id = project.id and item.disconnected_at is null
              order by item.updated_at desc limit 1) as drive_account_email,
            (select item.granted_scopes from public.drive_connections item
              where item.project_id = project.id and item.disconnected_at is null
              order by item.updated_at desc limit 1) as drive_granted_scopes
       from accessible_project project`,
    [data.user.id,active.project.id],
  );
  const summary = result.rows[0];
  if (!summary) redirect("/dashboard");
  const canConfigure =
    summary.role === "owner" || summary.role === "administrator";
  const folderReadAuthorized = Boolean(
    summary.drive_granted_scopes?.includes(
      "https://www.googleapis.com/auth/drive.readonly",
    ),
  );
  let oauthConfigured = false;
  let pickerConfigured = false;
  let previewConfigured = false;
  let r2Validated = false;
  let clamAvValidated = false;
  let oauthConfigurationInvalid = false;
  try {
    oauthConfigured = Boolean(
      await loadProjectGoogleOAuthConfig(database.pool, summary.project_id),
    );
    pickerConfigured = Boolean(
      await loadProjectGooglePickerConfig(database.pool, summary.project_id),
    );
  } catch {
    oauthConfigurationInvalid = true;
  }
  try {
    previewConfigured = Boolean(
      await loadProjectR2PreviewConfig(database.pool, summary.project_id),
    );
  } catch {
    previewConfigured = false;
  }
  const operationalIntegrations = await database.pool.query<{
    provider: string;
    validation_status: string | null;
    has_active_secret: boolean;
  }>(
    `select connection.provider,
            connection.configuration->>'validationStatus' validation_status,
            exists (
              select 1 from public.integration_secrets secret
               where secret.project_id = connection.project_id
                 and secret.provider = connection.provider
                 and secret.kind = 'credential_bundle'
                 and secret.rotated_at is null
            ) has_active_secret
       from public.connections connection
      where connection.project_id = $1 and connection.status = 'active'
        and connection.provider in ('cloudflare_r2', 'clamav')`,
    [summary.project_id],
  );
  r2Validated = operationalIntegrations.rows.some(
    (item) =>
      item.provider === "cloudflare_r2" &&
      item.validation_status === "valid" &&
      item.has_active_secret,
  );
  clamAvValidated = operationalIntegrations.rows.some(
    (item) => item.provider === "clamav" && item.validation_status === "valid",
  );
  const importInfrastructureReady = creativeImportReadiness({
    storageReady: r2Validated,
    antimalwareReady: clamAvValidated,
  }).ready;
  const folders = summary.drive_connection_id
    ? (
        await database.pool.query<AuthorizedFolder>(
          `select folder.id,folder.name,folder.include_subfolders,folder.status,
             coalesce(schedule.enabled,false) sync_enabled,
             coalesce(schedule.interval_minutes,60) interval_minutes,
             schedule.next_run_at,schedule.last_run_at
             from public.drive_folders folder left join public.drive_sync_schedules schedule
             on schedule.drive_folder_id=folder.id
            where folder.project_id = $1 and folder.drive_connection_id = $2
            order by folder.authorized_at desc`,
          [summary.project_id, summary.drive_connection_id],
        )
      ).rows
    : [];
  const inventoryJobs = (
    await database.pool.query<InventoryJob>(
      `select job.id, job.drive_folder_id, folder.name as folder_name,
              job.status::text, job.files_detected, job.error_code,
              job.created_at,
              (select count(*)::int from public.drive_import_items item
                where item.job_id = job.id and item.status = 'pending') as pending_items
         from public.drive_import_jobs job
         join public.drive_folders folder on folder.id = job.drive_folder_id
        where job.project_id = $1
        order by job.created_at desc
        limit 10`,
      [summary.project_id],
    )
  ).rows;
  const driveChanges=(
    await database.pool.query<DriveChangeItem>(
      `select change.id,folder.name folder_name,file.name file_name,
       change.external_file_id,change.change_type,change.observed_at
       from public.drive_change_records change
       join public.drive_folders folder on folder.id=change.drive_folder_id
       left join public.drive_files file on file.id=change.drive_file_id
       where change.project_id=$1 order by change.observed_at desc limit 30`,
      [summary.project_id],
    )
  ).rows;
  const library = (
    await database.pool.query<CreativeLibraryItem>(
      `select creative.id, creative.name, creative.status::text,
              version.id as version_id, version.version_number,
              asset.id as asset_id, asset.mime_type, asset.size_bytes::text,
              version.source_modified_at, folder.name as folder_name,
              count(*) over()::text total_count
         from public.creatives creative
         join public.creative_versions version
           on version.id = creative.current_version_id
         join public.creative_assets asset on asset.id = version.asset_id
         join public.drive_files file on file.id = version.source_drive_file_id
         join public.drive_folders folder on folder.id = file.drive_folder_id
        where creative.project_id = $1
          and asset.malware_status = 'clean'
          and asset.available_at is not null
          and ($2::text = '' or creative.name ilike '%' || $2 || '%')
          and ($3::text = '' or creative.status::text = $3)
          and ($4::text = '' or
            ($4 = 'image' and asset.mime_type like 'image/%') or
            ($4 = 'video' and asset.mime_type like 'video/%') or
            ($4 = 'text' and asset.mime_type = 'text/plain') or
            ($4 = 'document' and asset.mime_type in ('application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document')))
          and ($5::uuid is null or folder.id = $5)
        order by creative.updated_at desc
        limit $6 offset $7`,
      [summary.project_id,search,creativeStatus,mediaType,folderFilter||null,
       pageSize,(page-1)*pageSize],
    )
  ).rows;
  const totalLibrary=Number(library[0]?.total_count??0);
  const totalPages=Math.max(1,Math.ceil(totalLibrary/pageSize));
  const pageHref=(target:number)=>{
    const query=new URLSearchParams();
    if(search)query.set("q",search);
    if(creativeStatus)query.set("creative_status",creativeStatus);
    if(mediaType)query.set("media_type",mediaType);
    if(folderFilter)query.set("folder",folderFilter);
    query.set("page",String(target));
    return `/dashboard/criativos?${query.toString()}`;
  };

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/criativos" footerLabel="Fundação privada ativa" />

      <section className="app-content">
        <DashboardTopbar
          returnTo="/dashboard/criativos"
          statusLabel={oauthConfigured ? "Drive conectado" : "Importação desativada"}
        >
          <Link className="icon-button" href="/dashboard/campanhas/criativos">Criativos Meta</Link>
          <Link className="icon-button" href="/dashboard/campanhas/acoes">Aprovações</Link>
        </DashboardTopbar>

        <div className="dashboard-main creative-dashboard">
          <header className="dashboard-titlebar compact-titlebar creative-page-title">
            <div>
              <p className="eyebrow">Biblioteca e versionamento</p>
              <h1>Central de Criativos</h1>
              <p className="dashboard-context">A fundação de dados está pronta. Nenhum arquivo será importado até a conexão OAuth e o armazenamento privado estarem configurados.</p>
            </div>
          </header>

          {params.status === "drive-connected" ? <div className="notice notice-success">Google Drive conectado com OAuth oficial. Agora selecione uma pasta autorizada.</div> : null}
          {params.status === "oauth-denied" ? <div className="notice notice-error">A autorização foi cancelada no Google. Nenhum acesso foi salvo.</div> : null}
          {params.status?.startsWith("oauth-") && params.status !== "oauth-denied" ? <div className="notice notice-error">{driveOAuthErrorMessages[params.status]??"Não foi possível concluir o OAuth com segurança. Verifique a configuração e tente novamente."}</div> : null}
          {params.status === "forbidden" ? <div className="notice notice-error">Seu papel não permite conectar o Google Drive neste projeto.</div> : null}
          {oauthConfigurationInvalid ? <div className="notice notice-error">A configuração OAuth do servidor está incompleta ou inválida.</div> : null}
          {summary.drive_connection_id && !folderReadAuthorized ? (
            <div className="notice notice-error">
              A conexão atual autoriza a pasta, mas não seus arquivos internos.
              Reconecte o Google Drive para conceder o acesso somente de leitura
              necessário ao inventário.
            </div>
          ) : null}

          <section className="creative-foundation-grid">
            <article><span>Conexões Drive</span><strong>{summary.connections}</strong><small>OAuth oficial</small></article>
            <article><span>Pastas autorizadas</span><strong>{summary.folders}</strong><small>Escopo explícito</small></article>
            <article><span>Arquivos observados</span><strong>{summary.files}</strong><small>Origem preservada</small></article>
            <article><span>Criativos</span><strong>{summary.creatives}</strong><small>{summary.assets} ativo(s) internos</small></article>
          </section>

          {summary.drive_connection_id ? (
            <details className="creative-empty-state drive-folder-section creative-setup-panel" open={summary.creatives === 0}>
              <summary className="panel-heading">
                <div>
                  <p className="panel-label">Configuração da biblioteca</p>
                  <h2>Google Drive e sincronização</h2>
                </div>
                <span>{summary.drive_account_email ?? "Conta Google autorizada"}</span>
              </summary>
              <p>
                Escolha somente as pastas que o Funil Metrics poderá inventariar.
                A seleção não inicia importação nem publicação automática.
              </p>
              {!folderReadAuthorized && canConfigure && oauthConfigured ? (
                <Link
                  className="creative-connect-button"
                  href={`/dashboard/integracoes/google-drive/connect?projectId=${summary.project_id}`}
                >
                  Reconectar Google Drive para ler as pastas
                </Link>
              ) : null}
              {canConfigure && pickerConfigured && folderReadAuthorized ? (
                <DriveFolderPicker projectId={summary.project_id} />
              ) : !folderReadAuthorized ? null : (
                <div className="permission-state">
                  <strong>
                    {canConfigure
                      ? "Google Picker pendente de configuração"
                      : "Sem permissão para selecionar pastas"}
                  </strong>
                  <p>
                    {canConfigure
                      ? "Configure a chave do Picker e o número do projeto Google Cloud."
                      : "Solicite acesso de administrador ou proprietário."}
                  </p>
                </div>
              )}
              {folders.length ? (
                <div className="authorized-folder-list">
                  <h3>Pastas autorizadas</h3>
                  {folders.map((folder) => (
                    <article key={folder.id}>
                      <div>
                        <strong>{folder.name}</strong>
                        <small>
                          {folder.include_subfolders
                            ? "Inclui subpastas"
                            : "Somente esta pasta"}
                          {folder.sync_enabled && folder.next_run_at
                            ? ` · próxima: ${folder.next_run_at.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}`
                            : " · automática desligada"}
                        </small>
                      </div>
                      <div className="folder-actions">
                        <span>{folder.status}</span>
                        {canConfigure && folderReadAuthorized ? (
                          <DriveInventoryButton
                            folderId={folder.id}
                            projectId={summary.project_id}
                          />
                        ) : null}
                        {canConfigure ? (
                          <form action={saveDriveSyncSchedule}>
                            <input name="project_id" type="hidden" value={summary.project_id}/>
                            <input name="folder_id" type="hidden" value={folder.id}/>
                            <label><input defaultChecked={folder.sync_enabled} name="enabled" type="checkbox"/> Automática</label>
                            <select defaultValue={folder.interval_minutes} name="interval_minutes">
                              <option value="15">15 min</option>
                              <option value="60">1 hora</option>
                              <option value="360">6 horas</option>
                              <option value="1440">Diária</option>
                            </select>
                            <button type="submit">Salvar agenda</button>
                          </form>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="method-note">
                  <strong>Nenhuma pasta autorizada</strong>
                  <p>Use o seletor acima para conceder acesso explícito.</p>
                </div>
              )}
              {inventoryJobs.length ? (
                <div className="inventory-history">
                  <h3>Inventários recentes</h3>
                  {inventoryJobs.map((job) => (
                    <article key={job.id}>
                      <div>
                        <strong>{job.folder_name}</strong>
                        <small>
                          {job.files_detected} arquivo(s) compatível(is)
                          {job.error_code
                            ? ` · ${driveImportErrorMessages[job.error_code] ?? "Falha operacional registrada."}`
                            : ""}
                        </small>
                      </div>
                      <span>{job.status.replaceAll("_", " ")}</span>
                      {canConfigure &&
                      importInfrastructureReady &&
                      job.status === "completed" &&
                      job.pending_items > 0 ? (
                        <DriveImportButton
                          jobId={job.id}
                          projectId={summary.project_id}
                        />
                      ) : canConfigure &&
                        !importInfrastructureReady &&
                        job.status === "completed" &&
                        job.pending_items > 0 ? (
                        <div className="inventory-action">
                          <small>Confirmação bloqueada: valide R2 e ClamAV.</small>
                          <Link href="/dashboard/integracoes">Abrir Integrações</Link>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
              <div className="inventory-history">
                <h3>Mudanças recentes do Drive</h3>
                {driveChanges.length ? driveChanges.map((change)=>(
                  <article key={change.id}>
                    <div><strong>{change.file_name??change.external_file_id}</strong>
                      <small>{change.folder_name} · {change.observed_at.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</small>
                    </div>
                    <span>{change.change_type}</span>
                  </article>
                )):<div className="empty-state"><strong>Nenhuma mudança observada</strong>
                  <p>O histórico aparecerá após o próximo inventário completo.</p></div>}
              </div>
            </details>
          ) : summary.creatives === 0 ? (
            <section className="creative-empty-state">
              <div className="creative-empty-icon" aria-hidden="true">▦</div>
              <p className="panel-label">Biblioteca vazia</p>
              <h2>Nenhum criativo importado</h2>
              <p>
                {summary.drive_connection_id
                  ? importInfrastructureReady
                    ? "A infraestrutura privada está validada. Selecione uma pasta e execute o inventário para iniciar."
                    : "Valide R2 e ClamAV em Integrações antes de confirmar o primeiro download."
                  : "Conecte o Google Drive, selecione uma pasta e valide R2 e ClamAV antes do primeiro download."}
              </p>
              {canConfigure && oauthConfigured ? (
                <Link className="creative-connect-button" href={`/dashboard/integracoes/google-drive/connect?projectId=${summary.project_id}`}>Conectar Google Drive</Link>
              ) : canConfigure ? (
                <button disabled type="button">Conectar Google Drive — configuração pendente</button>
              ) : (
                <div className="permission-state"><strong>Sem permissão para configurar</strong><p>Solicite acesso de administrador ou proprietário.</p></div>
              )}
            </section>
          ) : null}

          <details className="creative-readiness creative-readiness-panel" open={summary.creatives === 0}>
            <summary className="panel-heading">
              <div><p className="panel-label">Infraestrutura</p><h2>Prontidão da importação</h2></div>
              <span>{importInfrastructureReady ? "Pronta" : "Requer configuração"}</span>
            </summary>
            <article><span className="readiness-ready">1</span><div><strong>Modelo e isolamento</strong><p>Entidades separadas, RLS e chaves compostas por organização e projeto.</p></div></article>
            <article><span className={summary.drive_connection_id && folders.length ? "readiness-ready" : undefined}>2</span><div><strong>OAuth e seleção de pasta</strong><p>{summary.drive_connection_id ? (folders.length ? "Conta e pasta(s) autorizadas com escopo restrito." : "Conta conectada; aguardando seleção explícita de pasta.") : "Aguardando conexão oficial com o Google."}</p></div></article>
            <article><span className={importInfrastructureReady ? "readiness-ready" : undefined}>3</span><div><strong>R2 e antimalware</strong><p>{importInfrastructureReady ? "Bucket privado e ClamAV validados para este projeto." : `${r2Validated ? "R2 validado" : "R2 pendente"} · ${clamAvValidated ? "ClamAV validado" : "ClamAV pendente"}.`}</p></div></article>
            <article><span className={importInfrastructureReady && Boolean(summary.drive_connection_id) ? "readiness-ready" : undefined}>4</span><div><strong>Importação manual</strong><p>{importInfrastructureReady ? "Download sujeito à confirmação humana, quarentena e varredura limpa." : "Confirmação bloqueada até validar R2 e ClamAV em Integrações."}</p></div></article>
            {!importInfrastructureReady && canConfigure ? (
              <Link className="creative-connect-button" href="/dashboard/integracoes">
                Configurar e validar integrações
              </Link>
            ) : null}
          </details>

          {summary.creatives ? (
            <section className="creative-library">
              <div className="section-heading">
                <div>
                  <p className="panel-label">Biblioteca privada</p>
                  <h2>Criativos importados</h2>
                </div>
                <span>{totalLibrary} item(ns) encontrado(s)</span>
              </div>
              <form className="inline-filter-form" method="get">
                <label>Buscar<input defaultValue={search} name="q" placeholder="Nome do criativo"/></label>
                <label>Status<select defaultValue={creativeStatus} name="creative_status">
                  <option value="">Todos</option>
                  {["new","imported","analyzing","awaiting_approval","approved","ready_to_publish","published","paused","winner","fatigued","archived"].map((status)=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
                </select></label>
                <label>Tipo<select defaultValue={mediaType} name="media_type">
                  <option value="">Todos</option><option value="video">Vídeo</option>
                  <option value="image">Imagem</option><option value="text">Texto</option>
                  <option value="document">Documento</option>
                </select></label>
                <label>Pasta<select defaultValue={folderFilter} name="folder">
                  <option value="">Todas</option>
                  {folders.map((folder)=><option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select></label>
                <button type="submit">Filtrar</button>
                {(search||creativeStatus||mediaType||folderFilter)?<Link className="secondary-button" href="/dashboard/criativos">Limpar</Link>:null}
              </form>
              {!previewConfigured ? (
                <div className="notice notice-error">
                  As versões estão preservadas, mas a prévia permanece bloqueada
                  até o acesso privado ao R2 ser configurado neste serviço.
                </div>
              ) : null}
              {library.length ? <div className="creative-card-grid">
                {library.map((creative) => {
                  const previewUrl = `/dashboard/criativos/assets/${creative.asset_id}`;
                  const isImage = creative.mime_type.startsWith("image/");
                  const isVideo = creative.mime_type.startsWith("video/");
                  return (
                    <article className="creative-card" key={creative.id}>
                      <div className="creative-preview">
                        {previewConfigured && isImage ? (
                          <Image
                            alt={`Prévia do criativo ${creative.name}`}
                            fill
                            sizes="(max-width: 720px) 100vw, 320px"
                            src={previewUrl}
                            unoptimized
                          />
                        ) : previewConfigured && isVideo ? (
                          <video controls preload="metadata">
                            <source
                              src={previewUrl}
                              type={creative.mime_type}
                            />
                          </video>
                        ) : (
                          <div className="creative-file-placeholder">
                            <span>▦</span>
                            <small>
                              {previewConfigured
                                ? "Documento armazenado"
                                : "Prévia indisponível"}
                            </small>
                          </div>
                        )}
                      </div>
                      <div className="creative-card-body">
                        <div>
                          <span className="creative-status">{creative.status}</span>
                          <small>Versão {creative.version_number}</small>
                        </div>
                        <h3>{creative.name}</h3>
                        <p>{creative.folder_name}</p>
                        <small>
                          {creative.mime_type} ·{" "}
                          {(Number(creative.size_bytes) / 1024 / 1024).toFixed(2)} MB
                        </small>
                        <Link
                          className="creative-card-link"
                          href={`/dashboard/criativos/${creative.id}`}
                        >
                          Ver detalhes e versões
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>:<div className="empty-state"><strong>Nenhum criativo corresponde aos filtros</strong><p>Altere ou limpe os filtros; os arquivos importados continuam preservados.</p></div>}
              {totalPages>1?<nav aria-label="Paginação da biblioteca" className="period-filter">
                {page>1?<Link href={pageHref(page-1)}>← Anterior</Link>:null}
                <span>Página {page} de {totalPages}</span>
                {page<totalPages?<Link href={pageHref(page+1)}>Próxima →</Link>:null}
              </nav>:null}
            </section>
          ) : null}

          {summary.pending_jobs || summary.failed_jobs ? (
            <div className="notice notice-error">
              Existem {summary.pending_jobs} job(s) pendente(s) e {summary.failed_jobs} com falha.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
