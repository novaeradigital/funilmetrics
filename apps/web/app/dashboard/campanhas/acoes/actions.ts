"use server";
import {createHash} from "node:crypto";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";

export async function requestCampaignAction(formData:FormData){
 const campaignId=String(formData.get("campaign_id")??"");
 const actionType=String(formData.get("action_type")??"");
 const reason=String(formData.get("reason")??"").trim().slice(0,1000);
 const budget=Number(formData.get("daily_budget")??0);
 if(!/^[0-9a-f-]{36}$/i.test(campaignId)||!["pause","set_daily_budget"].includes(actionType)
   ||reason.length<5||(actionType==="set_daily_budget"&&(!Number.isFinite(budget)||budget<=0)))
   redirect("/dashboard/campanhas/acoes?status=invalid");
 const supabase=await createClient();const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project||!["owner","administrator","editor"].includes(project.role))
   redirect("/dashboard/campanhas/acoes?status=forbidden");
 const db=getDatabase();const campaign=(await db.pool.query<{id:string;name:string;status:string|null;
  effective_status:string|null;meta_campaign_id:string;account_id:string;account_name:string;currency:string|null}>(`
  select c.id,c.name,c.status,c.effective_status,c.meta_campaign_id,a.id account_id,
   a.name account_name,a.currency from public.meta_campaigns c join public.meta_ad_accounts a
   on a.id=c.meta_ad_account_id where c.id=$1 and c.project_id=$2`,[campaignId,project.id])).rows[0];
 if(!campaign)redirect("/dashboard/campanhas/acoes?status=not-found");
 const snapshot={version:"campaign_action_v1",campaign,action:{type:actionType,
  dailyBudget:actionType==="set_daily_budget"?budget:null,currency:campaign.currency},reason};
 const canonical=JSON.stringify(snapshot);const hash=createHash("sha256").update(canonical).digest("hex");
 const client=await db.pool.connect();try{await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0]!;
  const row=(await client.query<{id:string}>(`insert into public.campaign_action_requests
   (organization_id,project_id,meta_campaign_id,action_type,snapshot,snapshot_sha256,reason,requested_by_user_id)
   values($1,$2,$3,$4,$5::jsonb,$6,$7,$8) returning id`,
   [project.organization_id,project.id,campaignId,actionType,canonical,hash,reason,actor.id])).rows[0]!;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'campaign_action_requested',
   'campaign_action_request',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,row.id,
   JSON.stringify({campaignId,actionType,snapshotSha256:hash})]);await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/campanhas/acoes?status=failed")}finally{client.release()}
 revalidatePath("/dashboard/campanhas/acoes");redirect("/dashboard/campanhas/acoes?status=requested");
}
export async function decideCampaignAction(formData:FormData){
 const id=String(formData.get("request_id")??""),decision=String(formData.get("decision")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!["approved","rejected"].includes(decision))
  redirect("/dashboard/campanhas/acoes?status=invalid");
 const supabase=await createClient();const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project||!["owner","administrator"].includes(project.role))
  redirect("/dashboard/campanhas/acoes?status=forbidden");
 const db=getDatabase(),client=await db.pool.connect();try{await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0]!;
  const row=(await client.query<{id:string}>(`update public.campaign_action_requests set status=$1,
   decided_by_user_id=$2,decided_at=now() where id=$3 and project_id=$4 and status='pending_approval'
   returning id`,[decision,actor.id,id,project.id])).rows[0];if(!row)throw new Error("not_pending");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,$4,'campaign_action_request',$5,$6::jsonb)`,
   [project.organization_id,project.id,actor.id,`campaign_action_${decision}`,id,JSON.stringify({decision})]);
  await client.query("commit");}catch{await client.query("rollback");redirect("/dashboard/campanhas/acoes?status=failed")}
 finally{client.release()}revalidatePath("/dashboard/campanhas/acoes");
 redirect(`/dashboard/campanhas/acoes?status=${decision}`);
}

export async function simulateCampaignAction(formData:FormData){
 const id=String(formData.get("request_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/campanhas/acoes?status=invalid");
 const supabase=await createClient();const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project||!["owner","administrator"].includes(project.role))
  redirect("/dashboard/campanhas/acoes?status=forbidden");
 const db=getDatabase(),client=await db.pool.connect();try{await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0]!;
  const row=(await client.query<{id:string;snapshot_sha256:string;snapshot:{
    campaign?:{status?:string|null;effective_status?:string|null;meta_campaign_id?:string;account_id?:string}};campaign_id:string;
    meta_campaign_id:string;status:string|null;effective_status:string|null;account_id:string}>(`
    select r.id,r.snapshot_sha256,r.snapshot,c.id campaign_id,c.meta_campaign_id,c.status,
      c.effective_status,a.id account_id from public.campaign_action_requests r
    join public.meta_campaigns c on c.id=r.meta_campaign_id
    join public.meta_ad_accounts a on a.id=c.meta_ad_account_id
    where r.id=$1 and r.project_id=$2 and r.status='approved'`,[id,project.id])).rows[0];
  if(!row)throw new Error("not_approved");
  const current={campaignId:row.campaign_id,metaCampaignId:row.meta_campaign_id,
    accountId:row.account_id,status:row.status,effectiveStatus:row.effective_status};
  const approved=row.snapshot.campaign??{};const discrepancies:string[]=[];
  if(approved.meta_campaign_id!==current.metaCampaignId)discrepancies.push("campaign_external_id_changed");
  if(approved.account_id!==current.accountId)discrepancies.push("account_changed");
  if(approved.status!==current.status||approved.effective_status!==current.effectiveStatus)
    discrepancies.push("campaign_status_changed");
  const simulationStatus=discrepancies.length?"reconciliation_required":"validated";
  await client.query(`insert into public.campaign_action_simulations(organization_id,project_id,
    campaign_action_request_id,status,approved_snapshot_sha256,current_state,discrepancies,
    simulated_by_user_id) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
    on conflict(campaign_action_request_id) do update set status=excluded.status,
    current_state=excluded.current_state,discrepancies=excluded.discrepancies,
    simulated_by_user_id=excluded.simulated_by_user_id,simulated_at=now()`,
    [project.organization_id,project.id,id,simulationStatus,row.snapshot_sha256,
      JSON.stringify(current),JSON.stringify(discrepancies),actor.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'campaign_action_simulated',
   'campaign_action_request',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,id,
   JSON.stringify({status:simulationStatus,discrepancies})]);await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/campanhas/acoes?status=simulation-failed")}
 finally{client.release()}revalidatePath("/dashboard/campanhas/acoes");
 redirect("/dashboard/campanhas/acoes?status=simulated");
}
