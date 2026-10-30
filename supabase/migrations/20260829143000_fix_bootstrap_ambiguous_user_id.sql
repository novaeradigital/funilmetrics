do $$
declare
  current_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.bootstrap_first_user()'::regprocedure)
    into current_definition;

  corrected_definition := replace(
    current_definition,
    E'update public.memberships\n       set',
    E'update public.memberships as membership\n       set'
  );

  corrected_definition := replace(
    corrected_definition,
    'where user_id = internal_user_id',
    'where membership.user_id = internal_user_id'
  );

  if corrected_definition = current_definition
     or position('where user_id = internal_user_id' in corrected_definition) > 0
     or position('where membership.user_id = internal_user_id' in corrected_definition) = 0 then
    raise exception 'bootstrap_first_user_definition_mismatch';
  end if;

  execute corrected_definition;
end;
$$;

revoke all on function public.bootstrap_first_user() from public;
revoke all on function public.bootstrap_first_user() from anon;
grant execute on function public.bootstrap_first_user() to authenticated;
