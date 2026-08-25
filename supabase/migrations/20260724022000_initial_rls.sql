create schema if not exists "private";

revoke all on schema "private" from public;
grant usage on schema "private" to authenticated;

create or replace function "private"."current_membership_role"(
  target_organization_id uuid
)
returns "public"."membership_role"
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  inner join public.users u on u.id = m.user_id
  where m.organization_id = target_organization_id
    and u.auth_user_id = auth.uid()
    and u.status = 'active'
  limit 1
$$;

create or replace function "private"."can_access_project"(
  target_organization_id uuid,
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    inner join public.users u on u.id = m.user_id
    where m.organization_id = target_organization_id
      and u.auth_user_id = auth.uid()
      and u.status = 'active'
      and (
        m.role in ('owner', 'administrator')
        or exists (
          select 1
          from public.project_memberships pm
          where pm.organization_id = target_organization_id
            and pm.project_id = target_project_id
            and pm.membership_id = m.id
        )
      )
  )
$$;

revoke all on function "private"."current_membership_role"(uuid) from public;
revoke all on function "private"."can_access_project"(uuid, uuid) from public;
grant execute on function "private"."current_membership_role"(uuid) to authenticated;
grant execute on function "private"."can_access_project"(uuid, uuid) to authenticated;

alter table "public"."organizations" enable row level security;
alter table "public"."projects" enable row level security;
alter table "public"."users" enable row level security;
alter table "public"."memberships" enable row level security;
alter table "public"."project_memberships" enable row level security;
alter table "public"."audit_logs" enable row level security;

create policy "users_select_self"
on "public"."users"
for select
to authenticated
using ("auth_user_id" = auth.uid());

create policy "organizations_select_member"
on "public"."organizations"
for select
to authenticated
using (
  "private"."current_membership_role"("id") is not null
);

create policy "projects_select_authorized"
on "public"."projects"
for select
to authenticated
using (
  "private"."can_access_project"("organization_id", "id")
);

create policy "memberships_select_same_organization"
on "public"."memberships"
for select
to authenticated
using (
  "private"."current_membership_role"("organization_id") is not null
);

create policy "project_memberships_select_authorized"
on "public"."project_memberships"
for select
to authenticated
using (
  "private"."can_access_project"("organization_id", "project_id")
);

create policy "audit_logs_select_administrators"
on "public"."audit_logs"
for select
to authenticated
using (
  "private"."current_membership_role"("organization_id")
    in ('owner', 'administrator')
);

revoke insert, update, delete on table "public"."organizations" from anon, authenticated;
revoke insert, update, delete on table "public"."projects" from anon, authenticated;
revoke insert, update, delete on table "public"."users" from anon, authenticated;
revoke insert, update, delete on table "public"."memberships" from anon, authenticated;
revoke insert, update, delete on table "public"."project_memberships" from anon, authenticated;
revoke insert, update, delete on table "public"."audit_logs" from anon, authenticated;
