import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { activateUser } from "../../../lib/activate-user";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=Confirmação inválida.", url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=Não foi possível confirmar a sessão.", url.origin),
    );
  }

  const { error: bootstrapError } = await supabase.rpc("bootstrap_first_user");

  if (bootstrapError) {
    await supabase.auth.signOut();
    const message = bootstrapError.message.includes("invitation_required")
      ? "O ambiente já possui proprietário. Solicite um convite."
      : "Não foi possível preparar seu acesso.";
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, url.origin),
    );
  }
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) await activateUser(authData.user.id);

  return NextResponse.redirect(new URL(next, url.origin));
}
