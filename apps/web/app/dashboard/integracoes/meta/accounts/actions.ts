"use server";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../../../lib/database";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

export async function saveMetaOAuthAccounts(formData:FormData){
  const connectionId=String(formData.get("connection_id")??"");
  const selected=formData.getAll("account_id").map(String)
    .filter((id)=>/^act_\d+$/.test(id));
  if(!connectionId||!selected.length) redirect(`/dashboard/integracoes?status=meta-accounts-required`);
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user) redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const database=getDatabase();
  const scope=await database.pool.query<{organization_id:string;project_id:string;actor_user_id:string}>(
    `select c.organization_id,c.project_id,u.id actor_user_id from public.connections c
     join public.users u on u.auth_user_id=$1 join public.memberships m
     on m.organization_id=c.organization_id and m.user_id=u.id
     where c.id=$2 and c.project_id=$3 and c.provider='meta_ads'
       and coalesce((select pm.role_override from public.project_memberships pm
                      where pm.membership_id=m.id and pm.project_id=c.project_id),m.role)
           in ('owner','administrator')
       and (not exists(select 1 from public.project_memberships restricted
                        where restricted.membership_id=m.id)
            or exists(select 1 from public.project_memberships allowed
                       where allowed.membership_id=m.id and allowed.project_id=c.project_id))
     limit 1`,
    [data.user.id,connectionId,active.project.id]);
  const row=scope.rows[0];if(!row) redirect("/dashboard/integracoes?status=forbidden");
  await database.pool.query(
    `update public.connections set configuration=configuration ||
       jsonb_build_object('adAccountAllowlist',$2::text),updated_at=now() where id=$1`,
    [connectionId,selected.join(",")]);
  await database.pool.query(
    `insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
     target_type,target_id,after) values($1,$2,$3,'meta_accounts_authorized',
     'connection',$4,$5::jsonb)`,
    [row.organization_id,row.project_id,row.actor_user_id,connectionId,
     JSON.stringify({accountIds:selected})]);
  redirect("/dashboard/integracoes?status=meta-oauth-connected");
}
