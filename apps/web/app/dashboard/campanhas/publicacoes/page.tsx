import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";

export const dynamic="force-dynamic";

export default async function PublicacoesPage(){
 const supabase=await createClient();
 const {data:authData}=await supabase.auth.getUser();
 if(!authData.user)redirect("/login");
 const {project}=await getActiveProject(authData.user.id);
 if(!project)redirect("/dashboard/projetos");
 return (
  <main className="app-layout">
   <DashboardSidebar activeHref="/dashboard/campanhas/publicacoes" footerLabel="Publicações"/>
   <section className="app-content">
    <DashboardTopbar returnTo="/dashboard/campanhas/publicacoes" statusLabel="Em implantação" statusTone="attention"><span/></DashboardTopbar>
    <div className="dashboard-main">
     <header className="dashboard-titlebar">
      <div><p className="eyebrow">Campanhas</p><h1>Publicações</h1>
      <p className="dashboard-context">Nenhuma publicação ainda. Quando uma campanha for enviada pelo Subir campanhas, o andamento por campanha, conjunto e anúncio, os erros e as retentativas aparecem aqui.</p></div>
     </header>
    </div>
   </section>
  </main>
 );
}
