"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDatabase } from "../../../lib/database";
import { getActiveProject } from "../../../lib/active-project";
import { createClient } from "../../../lib/supabase/server";

const roles = new Set([
  "administrator",
  "editor",
  "analyst",
  "viewer",
]);

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function inviteMember(formData: FormData) {
  const email = field(formData, "email").toLowerCase();
  const displayName = field(formData, "display_name");
  const role = field(formData, "role");
  if (!email.includes("@") || !displayName || !roles.has(role)) {
    redirect("/dashboard/equipe?status=invalid");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const active = await getActiveProject(authData.user.id);
  if (!active.project) redirect("/dashboard/equipe?status=forbidden");
  const database = getDatabase();
  const authorization = await database.pool.query<{
    internal_user_id: string;
    organization_id: string;
  }>(
    `select app_user.id as internal_user_id, membership.organization_id
       from public.users app_user
       join public.memberships membership on membership.user_id = app_user.id
      where app_user.auth_user_id = $1
        and membership.organization_id = $2
        and membership.role in ('owner','administrator')
      limit 1`,
    [authData.user.id, active.project.organization_id],
  );
  const scope = authorization.rows[0];
  if (!scope) redirect("/dashboard/equipe?status=forbidden");

  const client = await database.pool.connect();
  let accessGrantedImmediately = false;
  try {
    await client.query("begin");
    const existingUser = await client.query<{
      id: string;
      auth_user_id: string | null;
      status: string;
      has_membership: boolean;
    }>(
      `select app_user.id, app_user.auth_user_id, app_user.status::text,
              exists (
                select 1 from public.memberships membership
                 where membership.user_id = app_user.id
                   and membership.organization_id = $2
              ) as has_membership
         from public.users app_user
        where lower(app_user.email) = lower($1)
        limit 1
        for update`,
      [email, scope.organization_id],
    );
    const existing = existingUser.rows[0];
    accessGrantedImmediately = Boolean(existing?.auth_user_id);
    if (existing?.has_membership) {
      await client.query("rollback");
      redirect("/dashboard/equipe?status=existing");
    }
    const invitedUserId = existing?.id;
    const userResult = invitedUserId
      ? await client.query<{ id: string }>(
          `update public.users
              set display_name = $1,
                  status = case when auth_user_id is null then 'invited' else 'active' end,
                  updated_at = now()
            where id = $2
            returning id`,
          [displayName, invitedUserId],
        )
      : await client.query<{ id: string }>(
          `insert into public.users (
             email, display_name, status
           ) values ($1, $2, 'invited')
           returning id`,
          [email, displayName],
        );
    const persistedUserId = userResult.rows[0]?.id;
    if (!persistedUserId) throw new Error("invited_user_not_persisted");
    await client.query(
      `insert into public.memberships (
         organization_id, user_id, role, invited_by_user_id, joined_at
       ) values ($1, $2, $3::public.membership_role, $4, $5)
       on conflict (organization_id, user_id) do update set
         role = excluded.role,
         invited_by_user_id = excluded.invited_by_user_id,
         updated_at = now()`,
      [
        scope.organization_id,
        persistedUserId,
        role,
        scope.internal_user_id,
        existing?.auth_user_id ? new Date() : null,
      ],
    );
    const auditAction = existing?.auth_user_id
      ? "member_access_granted"
      : "member_access_pre_authorized";
    await client.query(
      `insert into public.audit_logs (
         organization_id, actor_user_id, action, target_type, target_id,
         reason, after
       ) values ($1, $2, $3, 'user', $4,
                 'Acesso administrado pelo painel',
                 $5::jsonb)`,
      [
        scope.organization_id,
        scope.internal_user_id,
        auditAction,
        persistedUserId,
        JSON.stringify({ email, displayName, role }),
      ],
    );
    await client.query("commit");
  } catch (databaseError) {
    if (
      typeof databaseError === "object" &&
      databaseError !== null &&
      "digest" in databaseError
    ) {
      throw databaseError;
    }
    await client.query("rollback");
    console.error("member_invitation_persistence_failed", {
      error:
        databaseError instanceof Error ? databaseError.message : "unknown",
    });
    redirect("/dashboard/equipe?status=error");
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/equipe");
  redirect(`/dashboard/equipe?status=${accessGrantedImmediately ? "granted" : "invited"}`);
}

async function requireTeamAdministrator(targetMembershipId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(targetMembershipId)) {
    redirect("/dashboard/equipe?status=invalid");
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const active = await getActiveProject(data.user.id);
  if (!active.project) redirect("/dashboard/equipe?status=forbidden");
  const database = getDatabase();
  const result = await database.pool.query<{
    organization_id: string;
    actor_user_id: string;
    actor_role: string;
    target_user_id: string;
    target_role: string;
    target_email: string;
  }>(
    `select actor_membership.organization_id,
            actor_user.id as actor_user_id,
            actor_membership.role::text as actor_role,
            target_user.id as target_user_id,
            target_membership.role::text as target_role,
            target_user.email as target_email
       from public.users actor_user
       join public.memberships actor_membership
         on actor_membership.user_id = actor_user.id
       join public.memberships target_membership
         on target_membership.organization_id = actor_membership.organization_id
        and target_membership.id = $2
       join public.users target_user on target_user.id = target_membership.user_id
      where actor_user.auth_user_id = $1
        and actor_user.status = 'active'
        and actor_membership.organization_id = $3
        and actor_membership.role in ('owner', 'administrator')
      limit 1`,
    [data.user.id, targetMembershipId, active.project.organization_id],
  );
  const scope = result.rows[0];
  if (!scope) redirect("/dashboard/equipe?status=forbidden");
  if (
    scope.target_role === "owner" ||
    scope.target_user_id === scope.actor_user_id
  ) {
    redirect("/dashboard/equipe?status=protected");
  }
  return { database, scope };
}

export async function changeMemberRole(formData: FormData) {
  const membershipId = field(formData, "membership_id");
  const role = field(formData, "role");
  if (!roles.has(role)) redirect("/dashboard/equipe?status=invalid");
  const { database, scope } = await requireTeamAdministrator(membershipId);
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update public.memberships
          set role = $1::public.membership_role, updated_at = now()
        where id = $2 and organization_id = $3`,
      [role, membershipId, scope.organization_id],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, actor_user_id, action, target_type, target_id,
         reason, before, after
       ) values ($1, $2, 'member_role_changed', 'user', $3,
                 'Papel alterado pelo painel', $4::jsonb, $5::jsonb)`,
      [
        scope.organization_id,
        scope.actor_user_id,
        scope.target_user_id,
        JSON.stringify({ role: scope.target_role }),
        JSON.stringify({ role }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect("/dashboard/equipe?status=error");
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/equipe");
  redirect("/dashboard/equipe?status=role-updated");
}

export async function resendMemberInvite(formData: FormData) {
  const membershipId = field(formData, "membership_id");
  const { database, scope } = await requireTeamAdministrator(membershipId);
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    const pending = await client.query<{ membership_id: string }>(
      `select membership.id as membership_id
         from public.memberships membership
         join public.users app_user on app_user.id = membership.user_id
        where membership.id = $1
          and membership.organization_id = $2
          and app_user.status = 'invited'
          and app_user.auth_user_id is null
        for update`,
      [membershipId, scope.organization_id],
    );
    if (!pending.rows[0]) {
      await client.query("rollback");
      redirect("/dashboard/equipe?status=invite-not-pending");
    }
    await client.query(
      `update public.memberships
          set invited_by_user_id = $1, updated_at = now()
        where id = $2 and organization_id = $3`,
      [scope.actor_user_id, membershipId, scope.organization_id],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, actor_user_id, action, target_type, target_id,
         reason, after
       ) values ($1, $2, 'member_invite_resent', 'user', $3,
                 'Instruções de acesso reemitidas pelo painel',
                 $4::jsonb)`,
      [
        scope.organization_id,
        scope.actor_user_id,
        scope.target_user_id,
        JSON.stringify({
          email: scope.target_email,
          registrationPath: "/login",
          delivery: "manual",
        }),
      ],
    );
    await client.query("commit");
  } catch (error) {
    if (typeof error === "object" && error !== null && "digest" in error) {
      throw error;
    }
    await client.query("rollback");
    redirect("/dashboard/equipe?status=error");
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/equipe");
  redirect("/dashboard/equipe?status=invite-resent");
}

export async function revokeMemberAccess(formData: FormData) {
  const membershipId = field(formData, "membership_id");
  const confirmation = field(formData, "confirmation");
  if (confirmation !== "REMOVER") {
    redirect("/dashboard/equipe?status=confirmation-required");
  }
  const { database, scope } = await requireTeamAdministrator(membershipId);
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from public.memberships
        where id = $1 and organization_id = $2`,
      [membershipId, scope.organization_id],
    );
    await client.query(
      `update public.users app_user
          set status = 'disabled', updated_at = now()
        where app_user.id = $1
          and not exists (
            select 1 from public.memberships remaining
             where remaining.user_id = app_user.id
          )`,
      [scope.target_user_id],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, actor_user_id, action, target_type, target_id,
         reason, before, after
       ) values ($1, $2, 'member_access_revoked', 'user', $3,
                 'Acesso removido pelo painel', $4::jsonb, $5::jsonb)`,
      [
        scope.organization_id,
        scope.actor_user_id,
        scope.target_user_id,
        JSON.stringify({
          email: scope.target_email,
          role: scope.target_role,
          access: "granted",
        }),
        JSON.stringify({ access: "revoked" }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect("/dashboard/equipe?status=error");
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/equipe");
  redirect("/dashboard/equipe?status=revoked");
}

export async function updateMemberProjectScope(formData: FormData) {
  const membershipId = field(formData, "membership_id");
  const scopeMode = field(formData, "scope_mode");
  const selectedProjectIds = formData
    .getAll("project_ids")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));
  if (
    !["all", "selected"].includes(scopeMode) ||
    (scopeMode === "selected" && selectedProjectIds.length === 0)
  ) {
    redirect("/dashboard/equipe?status=scope-required");
  }

  const { database, scope } = await requireTeamAdministrator(membershipId);
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    const currentScope = await client.query<{ project_id: string }>(
      `select project_id
         from public.project_memberships
        where membership_id = $1 and organization_id = $2
        order by project_id`,
      [membershipId, scope.organization_id],
    );
    if (scopeMode === "selected") {
      const allowedProjects = await client.query<{ id: string }>(
        `select id from public.projects
          where organization_id = $1 and id = any($2::uuid[])`,
        [scope.organization_id, selectedProjectIds],
      );
      if (allowedProjects.rows.length !== new Set(selectedProjectIds).size) {
        await client.query("rollback");
        redirect("/dashboard/equipe?status=invalid");
      }
    }

    await client.query(
      `delete from public.project_memberships
        where membership_id = $1 and organization_id = $2`,
      [membershipId, scope.organization_id],
    );
    if (scopeMode === "selected") {
      await client.query(
        `insert into public.project_memberships (
           organization_id, project_id, membership_id
         )
         select $1, selected.id, $2
           from unnest($3::uuid[]) as selected(id)`,
        [scope.organization_id, membershipId, [...new Set(selectedProjectIds)]],
      );
    }
    await client.query(
      `insert into public.audit_logs (
         organization_id, actor_user_id, action, target_type, target_id,
         reason, before, after
       ) values ($1, $2, 'member_project_scope_changed', 'user', $3,
                 'Escopo de projetos alterado pelo painel',
                 $4::jsonb, $5::jsonb)`,
      [
        scope.organization_id,
        scope.actor_user_id,
        scope.target_user_id,
        JSON.stringify({
          mode: currentScope.rows.length ? "selected" : "all",
          projectIds: currentScope.rows.map((row) => row.project_id),
        }),
        JSON.stringify({
          mode: scopeMode,
          projectIds: scopeMode === "selected" ? selectedProjectIds : [],
        }),
      ],
    );
    await client.query("commit");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error
    ) {
      throw error;
    }
    await client.query("rollback");
    redirect("/dashboard/equipe?status=error");
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/equipe");
  redirect("/dashboard/equipe?status=scope-updated");
}
