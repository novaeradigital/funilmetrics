import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { getActiveProject } from "../../../lib/active-project";
import { createClient } from "../../../lib/supabase/server";
import { signOut } from "../actions";
import { ProjectSwitcher } from "../project-switcher";
import { DashboardSidebar } from "../dashboard-sidebar";
import {
  changeMemberRole,
  inviteMember,
  resendMemberInvite,
  revokeMemberAccess,
  updateMemberProjectScope,
} from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  administrator: "Administrador",
  editor: "Editor",
  analyst: "Analista",
  viewer: "Visualizador",
};

type MemberRow = {
  membership_id: string;
  user_id: string;
  display_name: string | null;
  email: string;
  status: string;
  role: string;
  joined_at: string | null;
  created_at: string;
  project_ids: string[];
};

type ProjectRow = {
  id: string;
  name: string;
};

export default async function TeamPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const active = await getActiveProject(authData.user.id);
  if (!active.project) redirect("/dashboard/projetos");
  const database = getDatabase();
  const scopeResult = await database.pool.query<{
    organization_id: string;
    organization_name: string;
    role: string;
    internal_user_id: string;
  }>(
    `select organization.id as organization_id,
            organization.name as organization_name,
            membership.role::text,
            app_user.id as internal_user_id
       from public.users app_user
       join public.memberships membership on membership.user_id = app_user.id
       join public.organizations organization on organization.id = membership.organization_id
       join public.projects project on project.organization_id=organization.id and project.id=$2
       left join public.project_memberships project_membership
         on project_membership.membership_id=membership.id and project_membership.project_id=project.id
      where app_user.auth_user_id = $1
        and (not exists(select 1 from public.project_memberships restricted
                         where restricted.membership_id=membership.id)
             or project_membership.project_id is not null)
      limit 1`,
    [authData.user.id, active.project.id],
  );
  const scope = scopeResult.rows[0];
  if (!scope) redirect("/dashboard");
  const canManage = scope.role === "owner" || scope.role === "administrator";
  const members = await database.pool.query<MemberRow>(
    `select membership.id as membership_id, app_user.id as user_id,
            app_user.display_name, app_user.email,
            app_user.status::text, membership.role::text,
            membership.joined_at::text, membership.created_at::text,
            coalesce(
              (
                select array_agg(project_membership.project_id order by project_membership.project_id)
                  from public.project_memberships project_membership
                 where project_membership.membership_id = membership.id
              ),
              array[]::uuid[]
            ) as project_ids
       from public.memberships membership
       join public.users app_user on app_user.id = membership.user_id
      where membership.organization_id = $1
      order by case membership.role when 'owner' then 0 when 'administrator' then 1 else 2 end,
               app_user.display_name`,
    [scope.organization_id],
  );
  const projects = await database.pool.query<ProjectRow>(
    `select id, name
       from public.projects
      where organization_id = $1
      order by name`,
    [scope.organization_id],
  );
  const activeCount = members.rows.filter((member) => member.status === "active").length;
  const pendingCount = members.rows.filter((member) => member.status === "invited").length;

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/equipe" footerLabel="Acesso por papel" />
      <section className="app-content">
        <header className="app-topbar">
          <ProjectSwitcher returnTo="/dashboard/equipe" />
          <div className="topbar-actions"><span className="data-status"><i />{roleLabels[scope.role]}</span><form action={signOut}><button className="icon-button" type="submit">Sair</button></form></div>
        </header>
        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div><p className="eyebrow">Acesso e permissões</p><h1>Equipe</h1><p className="dashboard-context">Convide pessoas sem compartilhar senhas e atribua o menor papel necessário.</p></div>
          </header>
          {params.status === "invited" ? <div className="notice notice-success">Acesso pré-autorizado. Envie à pessoa o endereço da tela de cadastro.</div> : null}
          {params.status === "granted" ? <div className="notice notice-success">Acesso concedido ao usuário que já possuía uma conta confirmada.</div> : null}
          {params.status === "role-updated" ? <div className="notice notice-success">Papel atualizado e registrado na auditoria.</div> : null}
          {params.status === "invite-resent" ? <div className="notice notice-success">Convite renovado e auditado. Envie novamente à pessoa o endereço <strong>/login</strong>.</div> : null}
          {params.status === "invite-not-pending" ? <div className="notice notice-error">Este convite não está mais pendente.</div> : null}
          {params.status === "scope-updated" ? <div className="notice notice-success">Escopo de projetos atualizado e registrado na auditoria.</div> : null}
          {params.status === "revoked" ? <div className="notice notice-success">Acesso removido. O histórico e a auditoria foram preservados.</div> : null}
          {params.status === "existing" ? <div className="notice notice-error">Este e-mail já possui acesso ativo. Nenhuma permissão foi alterada.</div> : null}
          {params.status === "protected" ? <div className="notice notice-error">O proprietário e o próprio acesso administrativo não podem ser alterados por esta ação.</div> : null}
          {params.status === "confirmation-required" ? <div className="notice notice-error">Digite REMOVER para confirmar a retirada do acesso.</div> : null}
          {params.status === "scope-required" ? <div className="notice notice-error">Selecione ao menos um projeto para usar acesso restrito.</div> : null}
          {params.status === "invalid" ? <div className="notice notice-error">Confira nome, e-mail e papel.</div> : null}
          {params.status === "forbidden" ? <div className="notice notice-error">Seu papel não permite gerenciar a equipe.</div> : null}
          {params.status === "error" ? <div className="notice notice-error">Não foi possível concluir o convite com segurança.</div> : null}

          <section className="team-summary">
            <article><span>Membros</span><strong>{members.rows.length}</strong></article>
            <article><span>Ativos</span><strong>{activeCount}</strong></article>
            <article><span>Aguardando entrada</span><strong>{pendingCount}</strong></article>
          </section>

          <section className={`team-layout ${canManage ? "" : "team-readonly"}`}>
            {canManage ? (
              <article className="dashboard-card invite-card">
                <header className="card-header"><div><p className="panel-label">Novo acesso</p><h2>Pré-autorizar pessoa</h2></div></header>
                <form action={inviteMember}>
                  <label>Nome<input name="display_name" required /></label>
                  <label>E-mail<input name="email" type="email" required /></label>
                  <label>Papel<select name="role" defaultValue="analyst">
                    <option value="administrator">Administrador</option>
                    <option value="editor">Editor</option>
                    <option value="analyst">Analista</option>
                    <option value="viewer">Visualizador</option>
                  </select></label>
                  <button type="submit">Pré-autorizar acesso</button>
                  <small>Depois, envie à pessoa o link <strong>/login</strong>. Ela cria a própria senha e confirma o e-mail pelo Supabase.</small>
                </form>
              </article>
            ) : (
              <article className="dashboard-card permission-state"><strong>Acesso somente para leitura</strong><p>Apenas proprietários e administradores podem enviar convites.</p></article>
            )}
            <article className="dashboard-card members-card">
              <header className="card-header"><div><p className="panel-label">Acessos atuais</p><h2>Membros da organização</h2></div></header>
              <div className="members-list">
                {members.rows.map((member) => (
                  <div key={member.membership_id} className="member-row">
                    <span className="customer-avatar">{(member.display_name ?? member.email).slice(0, 1).toUpperCase()}</span>
                    <p><strong>{member.display_name ?? "Sem nome"}</strong><small>{member.email}</small></p>
                    <span className="member-role">{roleLabels[member.role] ?? member.role}</span>
                    <strong className={`member-state member-${member.status}`}>{member.status === "active" ? "Ativo" : "Convidado"}</strong>
                    {canManage &&
                    member.role !== "owner" &&
                    member.user_id !== scope.internal_user_id ? (
                      <details className="member-actions">
                        <summary>Gerenciar</summary>
                        {member.status === "invited" ? (
                          <form action={resendMemberInvite}>
                            <input type="hidden" name="membership_id" value={member.membership_id} />
                            <p className="member-action-note">Renova o convite e registra a ação. O acesso continua sendo criado pela própria pessoa em <strong>/login</strong>.</p>
                            <button type="submit">Reenviar convite</button>
                          </form>
                        ) : null}
                        <form action={changeMemberRole}>
                          <input type="hidden" name="membership_id" value={member.membership_id} />
                          <label>Papel<select name="role" defaultValue={member.role}>
                            <option value="administrator">Administrador</option>
                            <option value="editor">Editor</option>
                            <option value="analyst">Analista</option>
                            <option value="viewer">Visualizador</option>
                          </select></label>
                          <button type="submit">Salvar papel</button>
                        </form>
                        <form action={updateMemberProjectScope} className="member-scope-form">
                          <input type="hidden" name="membership_id" value={member.membership_id} />
                          <fieldset>
                            <legend>Escopo de projetos</legend>
                            <label className="scope-mode">
                              <input
                                type="radio"
                                name="scope_mode"
                                value="all"
                                defaultChecked={member.project_ids.length === 0}
                              />
                              Todos os projetos atuais e futuros
                            </label>
                            <label className="scope-mode">
                              <input
                                type="radio"
                                name="scope_mode"
                                value="selected"
                                defaultChecked={member.project_ids.length > 0}
                              />
                              Somente os selecionados
                            </label>
                            <div className="project-scope-list">
                              {projects.rows.map((project) => (
                                <label key={project.id}>
                                  <input
                                    type="checkbox"
                                    name="project_ids"
                                    value={project.id}
                                    defaultChecked={member.project_ids.includes(project.id)}
                                  />
                                  {project.name}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <button type="submit">Salvar escopo</button>
                        </form>
                        <form action={revokeMemberAccess} className="member-revoke-form">
                          <input type="hidden" name="membership_id" value={member.membership_id} />
                          <label>Digite REMOVER<input name="confirmation" autoComplete="off" /></label>
                          <button type="submit">Remover acesso</button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          </section>
          <div className="method-note"><strong>Papéis iniciais</strong><p>Administrador gerencia a operação; editor prepara alterações; analista consulta e analisa; visualizador possui acesso de leitura. Alterações críticas continuam exigindo regras e auditoria próprias.</p></div>
        </div>
      </section>
    </main>
  );
}
