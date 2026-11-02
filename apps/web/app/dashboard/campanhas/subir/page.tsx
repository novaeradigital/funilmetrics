import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";

export const dynamic="force-dynamic";

const steps=[
 {title:"1. Destino",text:"Contas de anúncio, Página e perfil de Instagram de cada conta."},
 {title:"2. Criativos",text:"Da Biblioteca, de upload manual ou de uma pasta do Drive."},
 {title:"3. Estrutura",text:"Presets 1-3-1 e 1-1-1 ou estrutura personalizada, com duplicação."},
 {title:"4. Conjunto",text:"Objetivo, pixel e evento, orçamento, público, URL e UTMs, com Modelos de subida salvos."},
 {title:"5. Copys, revisão e publicação",text:"Transcrição, 3 modelos de copy para aprovar, revisão completa e envio pausado ou ativo."},
];

export default async function SubirCampanhasPage(){
 const supabase=await createClient();
 const {data:authData}=await supabase.auth.getUser();
 if(!authData.user)redirect("/login");
 const {project}=await getActiveProject(authData.user.id);
 if(!project)redirect("/dashboard/projetos");
 return (
  <main className="app-layout">
   <DashboardSidebar activeHref="/dashboard/campanhas/subir" footerLabel="Subida de campanhas"/>
   <section className="app-content">
    <DashboardTopbar returnTo="/dashboard/campanhas/subir" statusLabel="Em implantação" statusTone="attention"><span/></DashboardTopbar>
    <div className="dashboard-main">
     <header className="dashboard-titlebar">
      <div><p className="eyebrow">Campanhas</p><h1>Subir campanhas</h1>
      <p className="dashboard-context">O assistente de subida está em implantação (módulo Campanhas, decisões D-169 a D-173). As etapas serão estas:</p></div>
     </header>
     <section className="dashboard-card">
      <ol>
       {steps.map(step=><li key={step.title}><strong>{step.title}</strong><p>{step.text}</p></li>)}
      </ol>
     </section>
    </div>
   </section>
  </main>
 );
}
