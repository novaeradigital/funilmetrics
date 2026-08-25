"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "../../../../lib/supabase/server";
import {getDatabase} from "../../../../lib/database";
import {getActiveProject} from "../../../../lib/active-project";

export async function linkMetaCreative(formData:FormData){
  const metaCreativeId=String(formData.get("meta_creative_id")??"");
  const versionId=String(formData.get("creative_version_id")??"");
  if(!/^[0-9a-f-]{36}$/i.test(metaCreativeId)||!/^[0-9a-f-]{36}$/i.test(versionId))
    redirect("/dashboard/campanhas/criativos?status=invalid");
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const database=getDatabase();const client=await database.pool.connect();
  try{
    await client.query("begin");
    const scope=(await client.query<{
      organization_id:string;actor_user_id:string;creative_id:string;
    }>(
      `select version.organization_id,app_user.id actor_user_id,version.creative_id
         from public.creative_versions version
         join public.meta_creatives meta
           on meta.project_id=version.project_id and meta.id=$3
         join public.users app_user on app_user.auth_user_id=$1
         join public.memberships membership
           on membership.organization_id=version.organization_id
          and membership.user_id=app_user.id
        where version.id=$2 and version.project_id=$4
          and coalesce((select allowed.role_override
                          from public.project_memberships allowed
                         where allowed.membership_id=membership.id
                           and allowed.project_id=version.project_id),membership.role)
              in('owner','administrator','editor')
          and (not exists(select 1 from public.project_memberships restricted
                           where restricted.membership_id=membership.id)
               or exists(select 1 from public.project_memberships allowed
                          where allowed.membership_id=membership.id
                            and allowed.project_id=version.project_id))
        limit 1`,[data.user.id,versionId,metaCreativeId,active.project.id])).rows[0];
    if(!scope){await client.query("rollback");redirect("/dashboard/campanhas/criativos?status=forbidden");}
    const linked=await client.query(
      `insert into public.creative_ad_links(
         organization_id,project_id,creative_id,creative_version_id,meta_ad_id,
         link_source,linked_by_user_id,updated_at
       )
       select $1,$2,$3,$4,ad.id,'manual',$5,now()
         from public.meta_ads ad
        where ad.project_id=$2 and ad.meta_creative_id=$6
       on conflict(project_id,meta_ad_id) do update set
         creative_id=excluded.creative_id,
         creative_version_id=excluded.creative_version_id,
         link_source='manual',linked_by_user_id=excluded.linked_by_user_id,
         updated_at=now()`,
      [scope.organization_id,active.project.id,scope.creative_id,versionId,
       scope.actor_user_id,metaCreativeId],
    );
    await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
       action,target_type,target_id,after)
       values($1,$2,$3,'creative_meta_ads_linked','meta_creative',$4,$5::jsonb)`,
      [scope.organization_id,active.project.id,scope.actor_user_id,metaCreativeId,
       JSON.stringify({creativeId:scope.creative_id,creativeVersionId:versionId,
         linkedAds:linked.rowCount??0,source:"manual"})],
    );
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    if(error&&typeof error==="object"&&"digest"in error)throw error;
    console.error("creative_meta_link_failed");
    redirect("/dashboard/campanhas/criativos?status=error");
  }finally{client.release();}
  revalidatePath("/dashboard/campanhas/criativos");
  redirect("/dashboard/campanhas/criativos?status=linked");
}
