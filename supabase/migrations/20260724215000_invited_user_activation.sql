create or replace function "public"."bootstrap_first_user"()
returns table (
  user_id uuid,
  organization_id uuid,
  project_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auth_user auth.users%rowtype;
  internal_user_id uuid;
  initial_organization_id uuid;
  initial_project_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  perform pg_advisory_xact_lock(hashtext('funil_metrics:first_user_bootstrap'));

  select *
    into current_auth_user
    from auth.users
   where id = auth.uid();

  if current_auth_user.id is null or current_auth_user.email is null then
    raise exception 'authenticated_user_not_found';
  end if;

  select u.id
    into internal_user_id
    from public.users u
   where u.auth_user_id = current_auth_user.id;

  if internal_user_id is not null then
    update public.users
       set status = 'active',
           updated_at = now()
     where id = internal_user_id;

    update public.memberships
       set joined_at = coalesce(joined_at, now()),
           updated_at = now()
     where user_id = internal_user_id;

    return query
      select
        internal_user_id,
        m.organization_id,
        coalesce(
          (
            select pm.project_id
              from public.project_memberships pm
             where pm.membership_id = m.id
             order by pm.created_at
             limit 1
          ),
          (
            select p.id
              from public.projects p
             where p.organization_id = m.organization_id
             order by p.created_at
             limit 1
          )
        )
      from public.memberships m
      where m.user_id = internal_user_id
      order by m.created_at
      limit 1;
    return;
  end if;

  select u.id
    into internal_user_id
    from public.users u
   where lower(u.email) = lower(current_auth_user.email)
     and u.auth_user_id is null
     and u.status = 'invited'
     and exists (
       select 1
         from public.memberships m
        where m.user_id = u.id
     )
   limit 1
   for update;

  if internal_user_id is not null then
    update public.users
       set auth_user_id = current_auth_user.id,
           status = 'active',
           display_name = coalesce(
             nullif(display_name, ''),
             nullif(current_auth_user.raw_user_meta_data ->> 'display_name', ''),
             split_part(current_auth_user.email, '@', 1)
           ),
           updated_at = now()
     where id = internal_user_id;

    update public.memberships
       set joined_at = coalesce(joined_at, now()),
           updated_at = now()
     where user_id = internal_user_id;

    select m.organization_id
      into initial_organization_id
      from public.memberships m
     where m.user_id = internal_user_id
     order by m.created_at
     limit 1;

    select coalesce(
      (
        select pm.project_id
          from public.project_memberships pm
          join public.memberships m on m.id = pm.membership_id
         where m.user_id = internal_user_id
           and m.organization_id = initial_organization_id
         order by pm.created_at
         limit 1
      ),
      (
        select p.id
          from public.projects p
         where p.organization_id = initial_organization_id
         order by p.created_at
         limit 1
      )
    )
    into initial_project_id;

    insert into public.audit_logs (
      organization_id,
      project_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      reason,
      after
    )
    values (
      initial_organization_id,
      initial_project_id,
      internal_user_id,
      'member_invitation_accepted',
      'user',
      internal_user_id::text,
      'Cadastro confirmado pelo usuário pré-autorizado',
      jsonb_build_object(
        'email', lower(current_auth_user.email),
        'joined_at', now()
      )
    );

    return query
      select internal_user_id, initial_organization_id, initial_project_id;
    return;
  end if;

  if exists (select 1 from public.organizations) then
    raise exception 'invitation_required';
  end if;

  insert into public.users (
    auth_user_id,
    email,
    display_name,
    status
  )
  values (
    current_auth_user.id,
    lower(current_auth_user.email),
    coalesce(
      nullif(current_auth_user.raw_user_meta_data ->> 'display_name', ''),
      split_part(current_auth_user.email, '@', 1)
    ),
    'active'
  )
  returning id into internal_user_id;

  insert into public.organizations (name, slug)
  values ('Funil Metrics', 'funil-metrics')
  returning id into initial_organization_id;

  insert into public.projects (
    organization_id,
    name,
    slug,
    timezone,
    currency
  )
  values (
    initial_organization_id,
    'Operação principal',
    'operacao-principal',
    'America/Sao_Paulo',
    'BRL'
  )
  returning id into initial_project_id;

  insert into public.memberships (
    organization_id,
    user_id,
    role,
    joined_at
  )
  values (
    initial_organization_id,
    internal_user_id,
    'owner',
    now()
  );

  insert into public.audit_logs (
    organization_id,
    project_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    after
  )
  values (
    initial_organization_id,
    initial_project_id,
    internal_user_id,
    'organization.bootstrap_completed',
    'organization',
    initial_organization_id::text,
    'Primeiro usuário autenticado do ambiente',
    jsonb_build_object(
      'organization_id', initial_organization_id,
      'project_id', initial_project_id,
      'owner_user_id', internal_user_id
    )
  );

  return query
    select internal_user_id, initial_organization_id, initial_project_id;
end;
$$;

revoke all on function "public"."bootstrap_first_user"() from public;
revoke all on function "public"."bootstrap_first_user"() from anon;
grant execute on function "public"."bootstrap_first_user"() to authenticated;
