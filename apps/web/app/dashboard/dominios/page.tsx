import Link from "next/link";import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {customDomainErrorLabel,customDomainStatusLabel} from "../../../lib/custom-domain";
import {verifyCustomDomain,updateProvisioningRequest,
 updateCustomDomainAvailability,rotateCustomDomainVerification,
 refreshCustomDomainHealth,createOwnedCloudflareDomain,refreshOwnedCloudflareDomain} from "./actions";
import {deleteCustomDomain} from "./actions";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
export const dynamic="force-dynamic";
type Domain={id:string;hostname:string;status:string;verification_token:string;
 verification_checked_at:Date|null;verified_at:Date|null;last_error_code:string|null;
 provisioning_requested_at:Date|null;railway_custom_domain_id:string|null;
 traffic_dns_type:string|null;traffic_dns_host:string|null;traffic_dns_value:string|null;
 provider_verification_dns_host:string|null;provider_verification_dns_value:string|null;
 certificate_status:string|null;provisioned_at:Date|null;last_health_checked_at:Date|null;
 dns_provider:string;cloudflare_zone_status:string|null;cloudflare_name_servers:string[];
 cloudflare_checked_at:Date|null;zone_hostname_count:number};
export default async function Page({searchParams}:{searchParams:Promise<{status?:string}>}){
 const query=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");const canManage=["owner","administrator"].includes(project.role);
 const domains=(await getDatabase().pool.query<Domain>(`select id,hostname,status::text,
  verification_token,verification_checked_at,verified_at,last_error_code,provisioning_requested_at,
  railway_custom_domain_id,traffic_dns_type,traffic_dns_host,traffic_dns_value,
  provider_verification_dns_host,provider_verification_dns_value,certificate_status,
  provisioned_at,last_health_checked_at,dns_provider,cloudflare_zone_status,
  cloudflare_name_servers,cloudflare_checked_at,
  case when cloudflare_zone_id is null then 0 else
   count(*) over(partition by cloudflare_zone_id) end::int as zone_hostname_count
  from public.custom_domains where project_id=$1 order by created_at desc`,[project.id])).rows;
 const success=["created","verified","provisioning-requested","provisioning-cancelled",
  "cloudflare-zone-created","nameservers-pending",
  "disabled","restored","verification-rotated","activated","deleted"].includes(query.status??"");
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/dominios" footerLabel="Domínios próprios"/>
  <section className="app-content">
  <DashboardTopbar returnTo="/dashboard/dominios" statusLabel="Domínios próprios"/><div className="dashboard-main">
  {query.status?<div className={success?"notice notice-success":"notice notice-error"}>{
   query.status==="cloudflare-zone-created"?"Domínio incluído na Cloudflare. Troque os nameservers no registrador pelos valores exibidos.":
   query.status==="nameservers-pending"?"A Cloudflare ainda aguarda a troca ou propagação dos nameservers.":
   query.status==="cloudflare-not-configured"?"Configure e valide a integração Cloudflare deste projeto.":
   query.status==="cloudflare-zone-failed"?"A Cloudflare não conseguiu criar ou localizar a zona. Confira token, conta e permissões.":
   query.status==="cloudflare-provisioning-failed"?"A zona ainda não pôde ser ativada ou vinculada ao Worker.":
   query.status==="deleted"?"Domínio excluído. O vínculo externo também foi removido e a auditoria foi preservada.":
   query.status==="delete-confirmation-invalid"?"Digite exatamente o hostname para confirmar a exclusão.":
   query.status==="zone-in-use"?"A zona Cloudflare não pode ser excluída porque ainda atende outros subdomínios.":
   query.status==="external-delete-failed"?"Não foi possível remover o vínculo na Cloudflare; nada foi apagado no Funil Metrics.":
   query.status==="created"?"Domínio cadastrado. Publique o TXT indicado antes de verificar.":
   query.status==="verified"?"Propriedade do domínio confirmada. A ativação ainda depende de hospedagem e TLS.":
   query.status==="provisioning-requested"?"Domínio criado na Railway. Publique os registros CNAME e TXT exibidos no cartão.":
   query.status==="activated"?"DNS, roteamento e HTTPS validados. O domínio está ativo.":
   query.status==="activation-pending"?"A ativação ainda aguarda DNS ou certificado HTTPS. Confira os registros e tente novamente.":
   query.status==="railway-not-configured"?"Configure e valide a integração Railway deste projeto antes de provisionar.":
   query.status==="provider-provisioning-failed"?"A Railway não concluiu o provisionamento. Valide a integração e tente novamente.":
   query.status==="cancel-unavailable"?"O domínio já foi criado na hospedagem e não pode ser cancelado apenas no banco local.":
   query.status==="provisioning-cancelled"?"Solicitação cancelada. O domínio permanece verificado.":
   query.status==="disabled"?"Domínio desativado. Links nesse hostname deixam de responder imediatamente.":
   query.status==="restored"?"Domínio restaurado para conferência. Verifique e solicite o provisionamento novamente.":
   query.status==="verification-rotated"?"Código TXT renovado. Publique o novo valor e confirme novamente a propriedade.":
   query.status==="dns-missing"?"Registro TXT ainda não foi encontrado. Aguarde a propagação e tente novamente.":
   query.status==="forbidden"?"Você não possui permissão para gerenciar domínios.":"Não foi possível concluir a ação."
  }</div>:null}
  {query.status==="cloudflare-not-configured"?<div className="method-note">
   <strong>Configuração necessária neste projeto</strong>
   <p>Abra Integrações, localize “Cloudflare · domínios próprios”, informe o Account ID e um API Token, salve e valide. Depois retorne para cadastrar o domínio.</p>
   <Link className="button-link" href="/dashboard/integracoes">Configurar Cloudflare agora</Link>
  </div>:null}
  <header className="dashboard-titlebar"><div><p className="eyebrow">Links e identidade</p><h1>Domínios personalizados</h1>
  <p className="dashboard-context">Cada domínio pertence ao projeto atual. Verificação DNS não ativa tráfego nem certificado automaticamente.</p></div></header>
  <section className="domain-layout"><article className="dashboard-card"><h2>Novo domínio próprio</h2>
  {canManage?<form action={createOwnedCloudflareDomain}>
   <label>Domínio principal<input name="zone_name" placeholder="suamarca.com.br" required/></label>
   <label>Subdomínio dos links<input name="hostname" placeholder="link.suamarca.com.br" required/></label>
   <small>O Funil Metrics cria a zona. Você só troca os nameservers no registrador.</small>
   <button>Adicionar à Cloudflare</button></form>:
   <div className="permission-state"><strong>Somente proprietários e administradores</strong></div>}</article>
  <article className="dashboard-card"><h2>Domínios do projeto</h2>{domains.length?<div className="members-list">
   {domains.map(domain=><div className="member-row domain-card" key={domain.id}><p><strong>{domain.hostname}</strong>
    <small>Status: {customDomainStatusLabel(domain.status)}</small>
    {domain.verification_checked_at?<small>Última verificação DNS: {domain.verification_checked_at.toLocaleString("pt-BR")}</small>:null}
    {domain.verified_at?<small>Propriedade confirmada em {domain.verified_at.toLocaleString("pt-BR")}</small>:null}
    {domain.provisioning_requested_at?<small>Provisionamento solicitado em {domain.provisioning_requested_at.toLocaleString("pt-BR")}</small>:null}
    {customDomainErrorLabel(domain.last_error_code)?<small className="status-error">
     {customDomainErrorLabel(domain.last_error_code)}</small>:null}</p>
    <details><summary>Configuração DNS e próximos passos</summary>
     {domain.dns_provider==="cloudflare_owned"?<div className="domain-provider-records">
      <h3>Cloudflare · domínio próprio</h3>
      <p>Status da zona: <strong>{domain.cloudflare_zone_status??"pendente"}</strong></p>
      <p>Troque os nameservers no registrador do domínio por:</p>
      {domain.cloudflare_name_servers.map(server=><code key={server}>{server}</code>)}
      <p className="member-action-note">Não crie registros manualmente para o Worker. Quando a zona ficar ativa, o Funil Metrics fará a vinculação.</p>
      {canManage?<form action={refreshOwnedCloudflareDomain}>
       <input type="hidden" name="domain_id" value={domain.id}/>
       <button>{domain.status==="active"?"Conferir novamente":"Verificar e ativar"}</button>
      </form>:null}
     </div>:null}
     {domain.dns_provider==="railway"?<>
     <p className="member-action-note">No provedor DNS, crie este registro de propriedade:</p>
     <p className="member-action-note">Tipo TXT</p>
     <code>_funil-metrics.{domain.hostname}</code><p className="member-action-note">Valor</p>
     <code>funil-metrics-verification={domain.verification_token}</code>
     <p className="member-action-note">Alguns provedores completam o domínio automaticamente. Confira na prévia se o nome final ficou exatamente <code>_funil-metrics.{domain.hostname}</code>.</p>
     {domain.traffic_dns_value?<div className="domain-provider-records">
      <h3>Roteamento e certificado Railway</h3>
      <p>Depois da propriedade confirmada, publique também estes registros no seu provedor DNS.</p>
      <div className="domain-record"><strong>{domain.traffic_dns_type??"CNAME"}</strong>
       <span>Nome/host</span><code>{domain.traffic_dns_host}</code>
       <span>Destino/valor</span><code>{domain.traffic_dns_value}</code></div>
      {domain.provider_verification_dns_value?<div className="domain-record"><strong>TXT da Railway</strong>
       <span>Nome/host</span><code>{domain.provider_verification_dns_host}</code>
       <span>Valor</span><code>{domain.provider_verification_dns_value}</code></div>:null}
      <p className="member-action-note">No Cloudflare, deixe o CNAME inicialmente como “Somente DNS” (nuvem cinza). A Railway emitirá e renovará o certificado HTTPS.</p>
      <small>Certificado: {domain.certificate_status??"aguardando"}{domain.last_health_checked_at?
       ` · última conferência ${domain.last_health_checked_at.toLocaleString("pt-BR")}`:""}</small>
     </div>:null}
     {canManage&&["pending_dns","error"].includes(domain.status)?<form action={verifyCustomDomain}>
      <input type="hidden" name="domain_id" value={domain.id}/><button>Verificar DNS agora</button></form>:null}
     {canManage&&domain.status==="verified"?<form action={updateProvisioningRequest}>
      <input type="hidden" name="domain_id" value={domain.id}/><input type="hidden" name="intent" value="request"/>
      <button>Solicitar provisionamento</button></form>:null}
     {canManage&&domain.status==="provisioning"&&!domain.railway_custom_domain_id?<form action={updateProvisioningRequest}>
      <input type="hidden" name="domain_id" value={domain.id}/><input type="hidden" name="intent" value="cancel"/>
      <button>Cancelar solicitação</button></form>:null}
     {canManage&&domain.traffic_dns_value&&["provisioning","active","error"].includes(domain.status)?
      <form action={refreshCustomDomainHealth}><input type="hidden" name="domain_id" value={domain.id}/>
       <button>{domain.status==="active"?"Conferir novamente":"Verificar ativação"}</button></form>:null}
     {canManage&&domain.status!=="disabled"?<form action={updateCustomDomainAvailability}>
      <input type="hidden" name="domain_id" value={domain.id}/><input type="hidden" name="intent" value="disable"/>
      <button className="danger-button">Desativar domínio</button></form>:null}
     {canManage&&domain.status==="disabled"?<form action={updateCustomDomainAvailability}>
      <input type="hidden" name="domain_id" value={domain.id}/><input type="hidden" name="intent" value="restore"/>
      <button>Restaurar para conferência</button></form>:null}
     {canManage&&!["active","provisioning"].includes(domain.status)?<form action={rotateCustomDomainVerification}>
     <input type="hidden" name="domain_id" value={domain.id}/>
      <button>Gerar novo código TXT</button></form>:null}
     </>:null}
     {canManage?
      <div className="domain-provider-records">
       <h3>Excluir definitivamente</h3>
       <p>Remove o hostname do Worker e do Funil Metrics. O histórico de auditoria será preservado.</p>
       <form action={deleteCustomDomain}>
        <input type="hidden" name="domain_id" value={domain.id}/>
        <label>Digite <strong>{domain.hostname}</strong>
         <input name="confirmation" autoComplete="off" required/>
        </label>
        {domain.dns_provider==="cloudflare_owned"&&domain.zone_hostname_count===1?
         <label><input type="checkbox" name="remove_zone" value="yes"/>
          Remover também a zona {domain.cloudflare_zone_status?"Cloudflare":""} (opcional)
         </label>:null}
        <button className="danger-button">Excluir domínio de vez</button>
       </form>
      </div>:null}
    </details></div>)}</div>:<div className="compact-empty">Nenhum domínio cadastrado neste projeto.</div>}</article></section>
  <section className="dashboard-card">
   <h2>Como configurar</h2>
   <ol className="domain-setup-steps">
    <li><strong>Configure a integração Cloudflare.</strong><p>Em Integrações, salve e valide a conta Cloudflare usada pelo projeto atual.</p></li>
    <li><strong>Cadastre o domínio principal e o subdomínio.</strong><p>Exemplo: domínio <code>suamarca.com</code> e subdomínio <code>link.suamarca.com</code>.</p></li>
    <li><strong>Troque os nameservers no registrador.</strong><p>O Funil Metrics cria ou reutiliza a zona e mostra os nameservers exatos. Essa troca é feita uma única vez por domínio principal.</p></li>
    <li><strong>Verifique e ative.</strong><p>Quando a zona estiver ativa, o Funil Metrics vincula o subdomínio ao Worker e conclui o HTTPS.</p></li>
   </ol>
   <div className="method-note"><strong>Onde troco os nameservers?</strong><p>No registrador onde o domínio foi comprado, como Registro.br, Hostinger ou GoDaddy. Não é necessário compartilhar login ou senha com o Funil Metrics.</p></div>
  </section>
  <div className="method-note"><strong>Próxima etapa após verificar</strong><p>O Funil Metrics ainda precisa provisionar o hostname na hospedagem, informar o destino CNAME, validar o certificado TLS e somente então mudar o estado para ativo. Não aponte tráfego antes de o destino aparecer nesta tela.</p></div>
  </div></section></main>;
}
