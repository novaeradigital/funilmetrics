import { getDatabase } from "./database";

export async function activateUser(authUserId: string) {
  const database = getDatabase();
  await database.pool.query(
    `with activated as (
       update public.users
          set status = 'active', updated_at = now()
        where auth_user_id = $1
        returning id
     )
     update public.memberships membership
        set joined_at = coalesce(membership.joined_at, now()),
            updated_at = now()
      where membership.user_id in (select id from activated)`,
    [authUserId],
  );
}
