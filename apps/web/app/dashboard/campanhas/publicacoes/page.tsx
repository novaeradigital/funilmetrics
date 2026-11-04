import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";
import {retryUpload} from "./actions";

export const dynamic="force-dynamic";

type UploadRow={id:string;status:string;send_mode:string;summary:Record<string,number>;error_message:string|null;created_at:string;finished_at:string|null;created_by:string};
type ItemRow={id:string;upload_id:string;account_external_id:string;level:string;name:string;status:string;external_id:string|null;error_message:string|null;payload:{stage?:string}|null};

const STATUS_LABEL:Record<string,string>={draft:"Rascunho",queued:"Na fila",publishing:"Publicando",completed:"Concluida",partial:"Parcial",failed:"Falhou",cancelled:"Cancelada",pending:"Pendente",creating:"Criando",created:"Criado",skipped:"Pulado"};
const LEVEL_LABEL:Record<string,string>={campaign:"Campanha",adset:"Conjunto",ad:"Anuncio"};

export default async function PublicacoesPage({searchParams}:{searchParams:Promise<{status?:string}>}){
 const query=await searchParams;
 const supabase=await createClient();
 const {data:authData}=await supabase.auth.getUser();
 if(!authData.user)redirect("/login");
 const {project}=await getActiveProject(authData.user.id);
 if(!project)redirect("/dashboard/projetos");
 const db=getDatabase();
 const uploads=(await db.pool.query<UploadRow>(
  `select u.id::text,u.status,u.send_mode,u.summary,u.error_message,
          u.created_at::text,u.finished_at::text,coalesce(us.display_name,us.email,'') as created_by
     from public.campaign_uploads u
     left join public.users us on us.id=u.created_by_user_id
    where u.project_id=$1 order by u.created_at desc limit 50`,[project.id])).rows;
 const items=uploads.length?(await db.pool.query<ItemRow>(
  `select id::text,upload_id::text,account_external_id,level,name,status,external_id,error_message,payload
     from public.campaign_upload_items where upload_id=any($1::uuid[])
    order by case level when 'campaign' then 0 when 'adset' then 1 else 2 end,created_at`,
  [uploads.map(u=>u.id)])).rows:[];
 const byUpload=new Map<string,ItemRow[]>();
 for(const item of items){
  const list=byUpload.get(item.upload_id)??[];list.push(item);byUpload.set(item.upload_id,list);
 }
 return (
  <main className="app-layout">
   <DashboardSidebar activeHref="/dashboard/campanhas/publicacoes" footerLabel="Publicações"/>
   <section className="app-content">
    <DashboardTopbar returnTo="/dashboard/campanhas/publicacoes" statusLabel="Modulo Campanhas" statusTone="default"><span/></DashboardTopbar>
    <div className="dashboard-main">
     <header className="dashboard-titlebar">
      <div><p className="eyebrow">Campanhas</p><h1>Publicações</h1>
      <p className="dashboard-context">Acompanhe cada subida: o que ja foi criado na Meta, o que falhou e o que falta. A retentativa reaproveita o que ja foi criado e tenta de novo so o que falhou.</p></div>
     </header>
     {query.status==="retried"&&<p>Publicacao recolocada na fila.</p>}
     {!uploads.length&&<section className="dashboard-card"><p>Nenhuma publicacao ainda. Monte a primeira em Subir campanhas.</p></section>}
     {uploads.map(upload=><section key={upload.id} className="dashboard-card" style={{marginBottom:16}}>
      <h2>{STATUS_LABEL[upload.status]??upload.status} · envio {upload.send_mode==="draft"?"rascunho":upload.send_mode==="paused"?"pausado":"ativo"}</h2>
      <p>{new Date(upload.created_at).toLocaleString("pt-BR")} · por {upload.created_by||"equipe"}
       {" · "}{upload.summary?.campaigns??0} campanha(s), {upload.summary?.adSets??0} conjunto(s), {upload.summary?.ads??0} anuncio(s)
       {upload.summary?.createdItems!==undefined?` · ${upload.summary.createdItems} criado(s), ${upload.summary.failedItems??0} com falha`:""}</p>
      {upload.error_message&&<p role="alert">{upload.error_message}</p>}
      {(upload.status==="partial"||upload.status==="failed")&&<form action={retryUpload}>
       <input type="hidden" name="upload_id" value={upload.id}/>
       <button type="submit" className="secondary-button">Tentar de novo o que falhou</button>
      </form>}
      <table>
       <thead><tr><th>Nivel</th><th>Nome</th><th>Conta</th><th>Status</th><th>ID na Meta</th><th>Erro</th></tr></thead>
       <tbody>{(byUpload.get(upload.id)??[]).map(item=><tr key={item.id}>
        <td>{LEVEL_LABEL[item.level]??item.level}</td><td>{item.name}</td><td>{item.account_external_id}</td>
        <td>{STATUS_LABEL[item.status]??item.status}{item.status==="creating"&&item.payload?.stage?<div style={{fontSize:12,opacity:0.75}}>{item.payload.stage}</div>:null}</td><td>{item.external_id??""}</td><td>{item.error_message??""}</td>
       </tr>)}</tbody>
      </table>
     </section>)}
    </div>
   </section>
  </main>
 );
}
