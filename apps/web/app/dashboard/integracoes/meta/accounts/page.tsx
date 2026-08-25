import { redirect } from "next/navigation";
import { getDatabase } from "../../../../../lib/database";
import { loadMetaConnectionAccessToken } from "../../../../../lib/meta-oauth";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";
import { saveMetaOAuthAccounts } from "./actions";

export const dynamic="force-dynamic";
type Account={id:string;name?:string;currency?:string;account_status?:number};

export default async function MetaAccountsPage({searchParams}:{searchParams:Promise<{connectionId?:string}>}){
  const {connectionId}=await searchParams;if(!connectionId) redirect("/dashboard/integracoes?status=invalid");
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user) redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const database=getDatabase();
  const allowed=await database.pool.query(
    `select 1 from public.connections c join public.users u on u.auth_user_id=$1
     join public.memberships m on m.organization_id=c.organization_id and m.user_id=u.id
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
  if(!allowed.rowCount) redirect("/dashboard/integracoes?status=forbidden");
  const token=await loadMetaConnectionAccessToken(database.pool,connectionId);
  if(!token) redirect("/dashboard/integracoes?status=meta-token-missing");
  const response=await fetch(
    "https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name,currency,account_status&limit=200",
    {headers:{Authorization:`Bearer ${token}`},cache:"no-store"},
  );
  if(!response.ok) redirect("/dashboard/integracoes?status=meta-accounts-failed");
  const payload=await response.json() as {data?:Account[]};
  const accounts=payload.data??[];
  return <main className="auth-shell"><section className="auth-card" style={{maxWidth:760}}>
    <p className="eyebrow">Meta Ads · autorização explícita</p>
    <h1>Escolha as contas deste projeto</h1>
    <p>Somente as contas marcadas poderão ser inventariadas. Você poderá revogar a conexão depois.</p>
    <form action={saveMetaOAuthAccounts}>
      <input type="hidden" name="connection_id" value={connectionId}/>
      <div className="integration-config-card">
        {accounts.length?accounts.map((account)=><label key={account.id}>
          <input type="checkbox" name="account_id" value={account.id}/>
          <span><strong>{account.name||account.id}</strong><br/><small>{account.id} · {account.currency||"moeda não informada"}</small></span>
        </label>):<div className="empty-state"><strong>Nenhuma conta disponível</strong><p>A identidade autorizada não possui contas de anúncios acessíveis.</p></div>}
      </div>
      <button disabled={!accounts.length} type="submit">Autorizar contas selecionadas</button>
    </form>
  </section></main>;
}
