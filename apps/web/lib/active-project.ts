import {cookies} from "next/headers";
import {getDatabase} from "./database";
import {resolveProjectSelection} from "./project-selection";

export const ACTIVE_PROJECT_COOKIE="funil_metrics_project";
export type ActiveProject={id:string;organization_id:string;name:string;slug:string;
  organization_name:string;timezone:string;currency:string;role:string};
export async function getAccessibleProjects(authUserId:string){
  const database=getDatabase();
  return (await database.pool.query<ActiveProject>(
    `select project.id,project.organization_id,project.name,project.slug,
      organization.name organization_name,
      project.timezone,project.currency,
      coalesce(allowed.role_override,membership.role)::text role
     from public.projects project
     join public.organizations organization on organization.id=project.organization_id
     join public.users app_user on app_user.auth_user_id=$1
     join public.memberships membership on membership.organization_id=project.organization_id
      and membership.user_id=app_user.id
     left join public.project_memberships allowed on allowed.membership_id=membership.id
      and allowed.project_id=project.id
     where app_user.status='active' and (not exists(select 1
      from public.project_memberships restricted where restricted.membership_id=membership.id)
      or allowed.project_id is not null)
     order by project.created_at,project.name`,[authUserId])).rows;
}

export async function getActiveProject(authUserId:string){
  const projects=await getAccessibleProjects(authUserId);
  const selected=(await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value;
  return {projects,...resolveProjectSelection(projects,selected)};
}
