"use server";

import { redirect } from "next/navigation";
import {cookies} from "next/headers";
import { createClient } from "../../lib/supabase/server";
import {ACTIVE_PROJECT_COOKIE} from "../../lib/active-project";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_PROJECT_COOKIE);
  redirect("/login");
}
