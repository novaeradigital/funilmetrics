"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";

export async function saveDriveSyncSchedule(formData:FormData){
  const projectId=String(formData.get("project_id")??""),folderId=String(formData.get("folder_id")??"");
  const enabled=formData.get("enabled")==="on",interval=Number(formData.get("interval_minutes")??60);
  if(!projectId||!folderId||!Number.isInteger(interval)||interval<15||interval>10080)
    redirect("/dashboard/criativos?status=sync-invalid");
  const supabase=await createClient();const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
  const database=getDatabase();
  const scope=await database.pool.query<{organization_id:string;actor_user_id:string}>(
    `select f.organization_id,u.id actor_user_id from public.drive_folders f
     join public.users u on u.auth_user_id=$1 join public.memberships m
     on m.organization_id=f.organization_id and m.user_id=u.id
     where f.id=$2 and f.project_id=$3 and m.role in ('owner','administrator') limit 1`,
    [data.user.id,folderId,projectId]);
  const row=scope.rows[0];if(!row)redirect("/dashboard/criativos?status=forbidden");
  await database.pool.query(
    `insert into public.drive_sync_schedules(organization_id,project_id,drive_folder_id,enabled,interval_minutes,next_run_at)
     values($1,$2,$3,$4,$5,case when $4 then now() else null end)
     on conflict(drive_folder_id) do update set enabled=excluded.enabled,
     interval_minutes=excluded.interval_minutes,next_run_at=case when excluded.enabled
     then coalesce(drive_sync_schedules.next_run_at,now()) else null end,updated_at=now()`,
    [row.organization_id,projectId,folderId,enabled,interval]);
  revalidatePath("/dashboard/criativos");
  redirect("/dashboard/criativos?status=sync-saved");
}
