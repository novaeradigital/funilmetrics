import { createHash,randomBytes } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import { loadMetaAppConfig,metaOAuthRedirectUri } from "../../../../../lib/meta-oauth";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

export async function GET(request:NextRequest){
  const supabase=await createClient(); const {data}=await supabase.auth.getUser();
  if(!data.user) return NextResponse.redirect(new URL("/login",request.url));
  const active=await getActiveProject(data.user.id);
  if(!active.project)return NextResponse.redirect(new URL("/dashboard/projetos",request.url));
  const projectId=request.nextUrl.searchParams.get("projectId");
  if(!projectId||projectId!==active.project.id)
    return NextResponse.redirect(new URL("/dashboard/integracoes?status=forbidden",request.url));
  const database=getDatabase();
  const scope=await database.pool.query<{organization_id:string;actor_user_id:string}>(
    `select p.organization_id,u.id actor_user_id from public.projects p
     join public.users u on u.auth_user_id=$1 join public.memberships m
     on m.organization_id=p.organization_id and m.user_id=u.id
     where p.id=$2
       and coalesce((select pm.role_override from public.project_memberships pm
                      where pm.membership_id=m.id and pm.project_id=p.id),m.role)
           in ('owner','administrator')
       and (not exists(select 1 from public.project_memberships restricted
                        where restricted.membership_id=m.id)
            or exists(select 1 from public.project_memberships allowed
                       where allowed.membership_id=m.id and allowed.project_id=p.id))
     limit 1`,[data.user.id,projectId]);
  if(!scope.rows[0]) return NextResponse.redirect(new URL("/dashboard/integracoes?status=forbidden",request.url));
  const config=await loadMetaAppConfig(database.pool,projectId);
  if(!config) return NextResponse.redirect(new URL("/dashboard/integracoes?status=meta-app-not-configured",request.url));
  const state=randomBytes(32).toString("base64url");
  await database.pool.query(
    `insert into public.meta_oauth_states
     (organization_id,project_id,requested_by_user_id,state_hash,expires_at)
     values($1,$2,$3,$4,now()+interval '10 minutes')`,
    [scope.rows[0].organization_id,projectId,scope.rows[0].actor_user_id,
     createHash("sha256").update(state).digest("hex")]);
  const url=new URL("https://www.facebook.com/v25.0/dialog/oauth");
  url.search=new URLSearchParams({client_id:config.appId,redirect_uri:metaOAuthRedirectUri,
    state,scope:"ads_read,business_management",response_type:"code"}).toString();
  return NextResponse.redirect(url);
}
