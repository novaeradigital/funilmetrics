"use server";
import {randomBytes} from "node:crypto";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "../../../lib/supabase/server";
import {getDatabase} from "../../../lib/database";
import {
  ACTIVE_PROJECT_COOKIE,
  getAccessibleProjects,
  getActiveProject,
} from "../../../lib/active-project";
import {safeDashboardReturn} from "../../../lib/safe-dashboard-return";

function field(data:FormData,name:string,max=200){
  const value=data.get(name);return typeof value==="string"?value.trim().slice(0,max):"";
}
function slugify(value:string){return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);}

export async function selectProject(data:FormData){
  const projectId=field(data,"project_id",64);
  const returnTo=safeDashboardReturn(field(data,"return_to",500));
  const supabase=await createClient();const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const projects=await getAccessibleProjects(auth.user.id);
  const selected=projects.find((item)=>item.id===projectId);
  if(!selected)redirect("/dashboard/projetos?status=forbidden");
  const database=getDatabase();
  await database.pool.query(
    `insert into public.audit_logs(organization_id,project_id,actor_user_id,
     action,target_type,target_id,after)
     select $1,$2,app_user.id,'active_project_changed','project',$5,
      jsonb_build_object('returnTo',$3::text)
     from public.users app_user where app_user.auth_user_id=$4`,
    [selected.organization_id,selected.id,returnTo,auth.user.id,selected.id],
  );
  (await cookies()).set(ACTIVE_PROJECT_COOKIE,projectId,{httpOnly:true,sameSite:"lax",
    secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*365});
  redirect(returnTo);
}

export async function createProject(data:FormData){
  const name=field(data,"name",120);const timezone=field(data,"timezone",80);
  const requestedOrganizationId=field(data,"organization_id",64);
  const currency=field(data,"currency",3).toUpperCase();
  if(name.length<2||!/^[A-Z]{3}$/.test(currency)||!timezone||
    !/^[0-9a-f-]{36}$/i.test(requestedOrganizationId))
    redirect("/dashboard/projetos?status=invalid");
  const supabase=await createClient();const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const active=await getActiveProject(auth.user.id);
  if(active.project&&active.project.organization_id!==requestedOrganizationId)
    redirect("/dashboard/projetos?status=forbidden");
  const database=getDatabase();const client=await database.pool.connect();
  try{
    await client.query("begin");
    const scope=(await client.query<{
      organization_id:string;actor_user_id:string;membership_id:string;
      has_project_restrictions:boolean;
    }>(
      `select membership.organization_id,app_user.id actor_user_id,
              membership.id membership_id,
              exists(select 1 from public.project_memberships restricted
                      where restricted.membership_id=membership.id)
                has_project_restrictions
       from public.users app_user join public.memberships membership on membership.user_id=app_user.id
       where app_user.auth_user_id=$1 and app_user.status='active'
        and membership.organization_id=$2
        and membership.role in('owner','administrator')
       order by membership.created_at limit 1 for update`,
      [auth.user.id,requestedOrganizationId])).rows[0];
    if(!scope){await client.query("rollback");redirect("/dashboard/projetos?status=forbidden");}
    const slug=`${slugify(name)||"projeto"}-${randomBytes(3).toString("hex")}`;
    const project=(await client.query<{id:string}>(
      `insert into public.projects(organization_id,name,slug,timezone,currency)
       values($1,$2,$3,$4,$5) returning id`,
      [scope.organization_id,name,slug,timezone,currency])).rows[0]!;
    if(scope.has_project_restrictions){
      await client.query(
        `insert into public.project_memberships(organization_id,project_id,membership_id)
         values($1,$2,$3) on conflict(project_id,membership_id) do nothing`,
        [scope.organization_id,project.id,scope.membership_id],
      );
    }
    await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
       action,target_type,target_id,after) values($1,$2,$3,'project_created',
       'project',$5,$4::jsonb)`,
      [scope.organization_id,project.id,scope.actor_user_id,
       JSON.stringify({name,slug,timezone,currency}),project.id]);
    await client.query("commit");
    (await cookies()).set(ACTIVE_PROJECT_COOKIE,project.id,{httpOnly:true,sameSite:"lax",
      secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*365});
  }catch(error){
    await client.query("rollback");
    if(error&&typeof error==="object"&&"digest"in error)throw error;
    console.error("project_create_failed",{code:error&&typeof error==="object"&&"code"in error?String(error.code):"unknown"});
    redirect("/dashboard/projetos?status=error");
  }finally{client.release();}
  revalidatePath("/dashboard","layout");redirect("/dashboard?status=project-created");
}

export async function updateProject(data:FormData){
  const projectId=field(data,"project_id",64);const name=field(data,"name",120);
  const timezone=field(data,"timezone",80);const currency=field(data,"currency",3).toUpperCase();
  if(!/^[0-9a-f-]{36}$/i.test(projectId)||name.length<2||!/^[A-Z]{3}$/.test(currency)||!timezone)
    redirect("/dashboard/projetos?status=invalid");
  const supabase=await createClient();const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const active=await getActiveProject(auth.user.id);
  if(!active.project||active.project.id!==projectId)
    redirect("/dashboard/projetos?status=forbidden");
  const database=getDatabase();const client=await database.pool.connect();
  try{
    await client.query("begin");
    const scope=(await client.query<{
      organization_id:string;actor_user_id:string;old_name:string;
      old_currency:string;old_timezone:string;
    }>(
      `select project.organization_id,app_user.id actor_user_id,
              project.name old_name,project.currency old_currency,
              project.timezone old_timezone
         from public.projects project
         join public.users app_user on app_user.auth_user_id=$1
         join public.memberships membership
           on membership.organization_id=project.organization_id
          and membership.user_id=app_user.id
        where project.id=$2 and app_user.status='active'
          and coalesce((select allowed.role_override
                          from public.project_memberships allowed
                         where allowed.membership_id=membership.id
                           and allowed.project_id=project.id),membership.role)
              in('owner','administrator')
          and (not exists(select 1 from public.project_memberships restricted
                           where restricted.membership_id=membership.id)
               or exists(select 1 from public.project_memberships allowed
                          where allowed.membership_id=membership.id
                            and allowed.project_id=project.id))
        limit 1 for update`,[auth.user.id,projectId])).rows[0];
    if(!scope){await client.query("rollback");redirect("/dashboard/projetos?status=forbidden");}
    await client.query(
      `update public.projects set name=$1,currency=$2,timezone=$3,updated_at=now()
        where id=$4 and organization_id=$5`,
      [name,currency,timezone,projectId,scope.organization_id],
    );
    await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
       action,target_type,target_id,before,after)
       values($1,$2,$3,'project_settings_updated','project',$6,$4::jsonb,$5::jsonb)`,
      [scope.organization_id,projectId,scope.actor_user_id,
       JSON.stringify({name:scope.old_name,currency:scope.old_currency,timezone:scope.old_timezone}),
       JSON.stringify({name,currency,timezone}),projectId],
    );
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    if(error&&typeof error==="object"&&"digest"in error)throw error;
    console.error("project_update_failed",{code:error&&typeof error==="object"&&"code"in error?String(error.code):"unknown"});
    redirect("/dashboard/projetos?status=error");
  }finally{client.release();}
  revalidatePath("/dashboard","layout");redirect("/dashboard/projetos?status=updated");
}
