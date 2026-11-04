import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";
import {UploadWizard,type WizardAccount,type WizardCreative,type WizardFolder,type WizardTemplate} from "./wizard";

export const dynamic="force-dynamic";

export default async function SubirCampanhasPage(){
 const supabase=await createClient();
 const {data:authData}=await supabase.auth.getUser();
 if(!authData.user)redirect("/login");
 const {project}=await getActiveProject(authData.user.id);
 if(!project)redirect("/dashboard/projetos");
 const db=getDatabase();
 const accounts=(await db.pool.query<WizardAccount>(
  `select id::text,external_id as "externalId",name,currency
     from public.meta_ad_accounts where project_id=$1 order by name`,[project.id])).rows;
 const creativeRows=(await db.pool.query<WizardCreative&{mimeType:string}>(
  `select c.id::text,c.name,a.mime_type as "mimeType",
          c.folder_id::text as "folderId",cf.name as "folderName",
          case when a.mime_type like 'video/%' then 'video'
               when a.mime_type like 'image/%' then 'imagem' else 'arquivo' end as format,
          (select t.text from public.creative_transcripts t
            where t.creative_version_id=c.current_version_id
            order by t.created_at desc limit 1) as transcript
     from public.creatives c
     join public.creative_versions v on v.id=c.current_version_id
     join public.creative_assets a on a.id=v.asset_id
     left join public.creative_folders cf on cf.id=c.folder_id
    where c.project_id=$1 and a.malware_status='clean' and a.available_at is not null
    order by c.created_at desc limit 200`,[project.id])).rows;
 const folders=(await db.pool.query<WizardFolder>(
  `select id::text,name from public.creative_folders
    where project_id=$1 order by name`,[project.id])).rows;
 const templates=(await db.pool.query<WizardTemplate>(
  `select id::text,name,config from public.campaign_upload_templates
    where project_id=$1 order by updated_at desc`,[project.id])).rows;
 const products=(await db.pool.query<{name:string}>(
  `select distinct name from public.commerce_products where project_id=$1
    order by name limit 100`,[project.id])).rows.map(r=>r.name);
 return (
  <main className="app-layout">
   <DashboardSidebar activeHref="/dashboard/campanhas/subir" footerLabel="Subida de campanhas"/>
   <section className="app-content">
    <DashboardTopbar returnTo="/dashboard/campanhas/subir" statusLabel="Modulo Campanhas" statusTone="default"><span/></DashboardTopbar>
    <div className="dashboard-main">
     <header className="dashboard-titlebar">
      <div><p className="eyebrow">Campanhas</p><h1>Subir campanhas</h1>
      <p className="dashboard-context">Monte a subida em 5 etapas, revise tudo e envie pausada ou ativa. Rascunhos ficam salvos sem ir para a Meta.</p></div>
     </header>
     <UploadWizard accounts={accounts} creatives={creativeRows} templates={templates} products={products} folders={folders}/>
    </div>
   </section>
  </main>
 );
}
