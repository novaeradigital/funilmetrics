import {createClient} from "../../lib/supabase/server";
import {getActiveProject} from "../../lib/active-project";
import {DashboardSidebarClient} from "./dashboard-sidebar-client";

type DashboardSidebarProps={
  activeHref:string;
  footerLabel?:string;
};

export async function DashboardSidebar({activeHref,footerLabel}:DashboardSidebarProps){
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  const context=data.user?await getActiveProject(data.user.id):{projects:[],project:null,selection:"none" as const};
  return <DashboardSidebarClient activeHref={activeHref} footerLabel={footerLabel}
    projects={context.projects.map(project=>({
      id:project.id,name:project.name,organizationName:project.organization_name,
      organizationId:project.organization_id,slug:project.slug,
    }))} activeProjectId={context.project?.id??null}/>;
}
