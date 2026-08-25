"use server";
import {redirect} from "next/navigation";import {revalidatePath} from "next/cache";
import {createClient} from "../../../lib/supabase/server";import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";
const read=(data:FormData,key:string,max=500)=>String(data.get(key)??"").trim().slice(0,max);
export async function createExperiment(data:FormData){
  const name=read(data,"name",120),slug=read(data,"slug",60).toLowerCase();
  const a=read(data,"destination_a"),b=read(data,"destination_b");
  const weightA=Number(read(data,"weight_a",4)),weightB=100-weightA;
  if(name.length<2||!/^[a-z0-9-]{3,60}$/.test(slug)||weightA<1||weightA>99)
    redirect("/dashboard/experimentos?status=invalid");
  try{new URL(a);new URL(b)}catch{redirect("/dashboard/experimentos?status=invalid")}
  if(!a.startsWith("https://")||!b.startsWith("https://"))redirect("/dashboard/experimentos?status=invalid");
  const supabase=await createClient();const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");const {project}=await getActiveProject(auth.user.id);
  if(!project)redirect("/dashboard/projetos");const database=getDatabase(),client=await database.pool.connect();
  try{await client.query("begin");const actor=(await client.query<{id:string}>(
    `select u.id from public.users u join public.memberships m on m.user_id=u.id
      where u.auth_user_id=$1 and m.organization_id=$2 and m.role in('owner','administrator','editor') limit 1`,
    [auth.user.id,project.organization_id])).rows[0];if(!actor)redirect("/dashboard/experimentos?status=forbidden");
    const experiment=(await client.query<{id:string}>(`insert into public.experiments(
      organization_id,project_id,name,slug,status,created_by_user_id)
      values($1,$2,$3,$4,'active',$5) returning id`,
      [project.organization_id,project.id,name,slug,actor.id])).rows[0]!;
    await client.query(`insert into public.experiment_variants(organization_id,project_id,
      experiment_id,name,destination_url,weight,position) values
      ($1,$2,$3,'A',$4,$5,1),($1,$2,$3,'B',$6,$7,2)`,
      [project.organization_id,project.id,experiment.id,a,weightA,b,weightB]);
    await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
      action,target_type,target_id,after) values($1,$2,$3,'smart_link_created','experiment',$4,$5::jsonb)`,
      [project.organization_id,project.id,actor.id,experiment.id,JSON.stringify({slug,weights:[weightA,weightB]})]);
    await client.query("commit");
  }catch(error){await client.query("rollback");if(error&&typeof error==="object"&&"digest"in error)throw error;
    redirect("/dashboard/experimentos?status=error")}finally{client.release()}
  revalidatePath("/dashboard/experimentos");redirect("/dashboard/experimentos?status=created");
}

export async function updateExperimentStatus(data:FormData){
  const experimentId=read(data,"experiment_id",64),status=read(data,"status",20);
  if(!/^[0-9a-f-]{36}$/i.test(experimentId)||!["active","paused"].includes(status))
    redirect("/dashboard/experimentos?status=invalid");
  const supabase=await createClient();const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");const {project}=await getActiveProject(auth.user.id);
  if(!project)redirect("/dashboard/projetos");const database=getDatabase();
  const actor=(await database.pool.query<{id:string}>(
    `select u.id from public.users u join public.memberships m on m.user_id=u.id
      where u.auth_user_id=$1 and m.organization_id=$2
        and m.role in('owner','administrator','editor') limit 1`,
    [auth.user.id,project.organization_id])).rows[0];
  if(!actor)redirect("/dashboard/experimentos?status=forbidden");
  const changed=await database.pool.query(`update public.experiments
    set status=$1::public.experiment_status,updated_at=now()
    where id=$2 and project_id=$3`,[status,experimentId,project.id]);
  if(!changed.rowCount)redirect("/dashboard/experimentos?status=invalid");
  await database.pool.query(`insert into public.audit_logs(organization_id,project_id,
    actor_user_id,action,target_type,target_id,after)
    values($1,$2,$3,'experiment_status_changed','experiment',$4,$5::jsonb)`,
  [project.organization_id,project.id,actor.id,experimentId,JSON.stringify({status})]);
  revalidatePath("/dashboard/experimentos");
  redirect("/dashboard/experimentos?status=status-updated");
}
