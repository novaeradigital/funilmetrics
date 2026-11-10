import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import {
  decryptIntegrationSecret,
  loadIntegrationVaultKey,
} from "../../../../lib/integration-vault";
import { loadIntelligenceData } from "../../../../lib/intelligence-data";
import {
  INTELLIGENCE_CHAT_SYSTEM,
  buildIntelligenceContext,
  citedContextText,
  loadCitedCreatives,
} from "../../../../lib/intelligence-chat-context";

export const dynamic = "force-dynamic";

type StoredProvider = {
  configuration: Record<string, unknown>;
  ciphertext: Buffer;
  initialization_vector: Buffer;
  authentication_tag: Buffer;
};

async function loadOpenRouter(projectId: string) {
  const db = getDatabase();
  const stored = (
    await db.pool.query<StoredProvider>(
      `select connection.configuration, secret.ciphertext,
         secret.initialization_vector, secret.authentication_tag
         from public.connections connection
         join lateral (
           select ciphertext, initialization_vector, authentication_tag
             from public.integration_secrets
            where project_id = connection.project_id and provider = 'openrouter'
              and kind = 'credential_bundle' and rotated_at is null
            order by created_at desc limit 1
         ) secret on true
        where connection.project_id = $1 and connection.provider = 'openrouter'
          and connection.status = 'active'
        order by connection.created_at desc limit 1`,
      [projectId],
    )
  ).rows[0];
  const key = loadIntegrationVaultKey();
  if (!stored || !key) return null;
  const bundle = {
    ciphertext: stored.ciphertext,
    initializationVector: stored.initialization_vector,
    authenticationTag: stored.authentication_tag,
  };
  const secret = decryptIntegrationSecret(bundle, key);
  const apiKey = String(secret.apiKey ?? "").trim();
  const model = String(stored.configuration.analysisModel ?? "").trim();
  if (!apiKey) return null;
  return { apiKey, model };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Sessão expirada. Recarregue a página." }, { status: 401 });
  }
  const active = await getActiveProject(authData.user.id);
  if (!active.project) {
    return NextResponse.json({ error: "Nenhum projeto ativo." }, { status: 400 });
  }
  const project = active.project;
  const body = (await request.json().catch(() => null)) as {
    message?: string;
    model?: string;
    from?: string | null;
    to?: string | null;
    businessId?: string | null;
    accountIds?: string[] | null;
    scopeLabel?: string;
  } | null;
  const message = String(body?.message ?? "").trim().slice(0, 2000);
  if (!message) {
    return NextResponse.json({ error: "Mensagem vazia." }, { status: 400 });
  }

  const db = getDatabase();
  const appUser = (
    await db.pool.query<{ id: string }>(
      `select id from public.users where auth_user_id = $1 limit 1`,
      [authData.user.id],
    )
  ).rows[0];
  if (!appUser) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 400 });
  }

  const provider = await loadOpenRouter(project.id).catch(() => null);
  if (!provider) {
    return NextResponse.json(
      { error: "O cartão OpenRouter não está configurado em Integrações. Configure a chave e o modelo de análise para usar o chat." },
      { status: 400 },
    );
  }
  const allowedModels = [
    provider.model,
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4o-mini",
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  const model =
    body?.model && allowedModels.includes(body.model) ? body.model : provider.model;

  const history = (
    await db.pool.query<{ role: string; content: string }>(
      `select role, content from public.intelligence_chat_messages
        where project_id = $1 and user_id = $2
        order by created_at desc limit 20`,
      [project.id, appUser.id],
    )
  ).rows.reverse();

  const data = await loadIntelligenceData(db.pool, {
    projectId: project.id,
    organizationId: project.organization_id,
    userAuthId: authData.user.id,
    from: body?.from ?? null,
    to: body?.to ?? null,
    accountIds: body?.accountIds ?? null,
    businessId: body?.businessId ?? null,
    timezone: project.timezone,
  });
  const cited = await loadCitedCreatives(db.pool, project.id, message);
  const context =
    buildIntelligenceContext(data, body?.scopeLabel ?? "filtros atuais da página") +
    citedContextText(cited);

  await db.pool.query(
    `insert into public.intelligence_chat_messages
       (organization_id, project_id, user_id, role, content, model)
     values ($1, $2, $3, 'user', $4, $5)`,
    [project.organization_id, project.id, appUser.id, message, model],
  );

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `${INTELLIGENCE_CHAT_SYSTEM}\n\nCONTEXTO:\n${context}` },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: message },
      ],
    }),
  });
  if (!response.ok) {
    return NextResponse.json(
      { error: `O OpenRouter respondeu ${response.status}. Tente de novo em instantes.` },
      { status: 502 },
    );
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const reply = String(payload.choices?.[0]?.message?.content ?? "").trim();
  if (!reply) {
    return NextResponse.json({ error: "Resposta vazia do modelo." }, { status: 502 });
  }
  await db.pool.query(
    `insert into public.intelligence_chat_messages
       (organization_id, project_id, user_id, role, content, model)
     values ($1, $2, $3, 'assistant', $4, $5)`,
    [project.organization_id, project.id, appUser.id, reply, model],
  );
  return NextResponse.json({ reply, model });
}
