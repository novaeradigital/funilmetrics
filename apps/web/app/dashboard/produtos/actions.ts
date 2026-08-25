"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";

const roles=new Set(["primary","order_bump","upsell","downsell","subscription","addon","unknown"]);
export async function classifyProduct(formData:FormData){
  const productId=String(formData.get("product_id")??""),role=String(formData.get("role")??"");
  const parentId=String(formData.get("parent_product_id")??"")||null;
  const reason=String(formData.get("reason")??"").trim().slice(0,1000);
  if(!productId||!roles.has(role)||parentId===productId)redirect("/dashboard/produtos?status=classification-invalid");
  const supabase=await createClient();const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
  const database=getDatabase();
  const scope=await database.pool.query<{organization_id:string;project_id:string;actor_user_id:string}>(
    `select product.organization_id,product.project_id,u.id actor_user_id
     from public.commerce_products product join public.users u on u.auth_user_id=$1
     join public.memberships m on m.organization_id=product.organization_id and m.user_id=u.id
     where product.id=$2 and m.role in ('owner','administrator') and
       ($3::uuid is null or exists(select 1 from public.commerce_products parent
        where parent.id=$3 and parent.project_id=product.project_id)) limit 1`,
    [data.user.id,productId,parentId]);
  const row=scope.rows[0];if(!row)redirect("/dashboard/produtos?status=forbidden");
  const client=await database.pool.connect();
  try{
    await client.query("begin");
    await client.query(`update public.product_classifications set effective_until=now()
      where product_id=$1 and effective_until is null`,[productId]);
    await client.query(`insert into public.product_classifications(organization_id,project_id,
      product_id,role,parent_product_id,source,reason,classified_by_user_id)
      values($1,$2,$3,$4::public.product_journey_role,$5,'manual',$6,$7)`,
      [row.organization_id,row.project_id,productId,role,parentId,reason||null,row.actor_user_id]);
    await client.query(`insert into public.audit_logs(organization_id,project_id,
      actor_user_id,action,target_type,target_id,after)
      values($1,$2,$3,'product_classification_updated','commerce_product',$4,$5::jsonb)`,
      [row.organization_id,row.project_id,row.actor_user_id,productId,
       JSON.stringify({role,parentProductId:parentId,reason:reason||null})]);
    await client.query("commit");
  }catch{await client.query("rollback");redirect("/dashboard/produtos?status=classification-failed")}
  finally{client.release()}
  revalidatePath("/dashboard/produtos");redirect("/dashboard/produtos?status=classification-saved");
}
