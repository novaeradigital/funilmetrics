"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { getDatabase } from "../../../lib/database";
import { DEFAULT_THRESHOLDS, type VerdictKind } from "../../../lib/intelligence-rules";

type Actor = {
  appUserId: string;
  projectId: string;
  organizationId: string;
};

async function requireActor(): Promise<Actor> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("unauthenticated");
  const active = await getActiveProject(authData.user.id);
  if (!active.project) throw new Error("no_active_project");
  const db = getDatabase();
  const appUser = (
    await db.pool.query<{ id: string }>(
      `select id from public.users where auth_user_id = $1 limit 1`,
      [authData.user.id],
    )
  ).rows[0];
  if (!appUser) throw new Error("app_user_missing");
  return {
    appUserId: appUser.id,
    projectId: active.project.id,
    organizationId: active.project.organization_id,
  };
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function scopeKey(businessId: string | null): string {
  return businessId ?? ZERO_UUID;
}

/** Dispensar (some e fica registrado) ou adiar um cartao do quadro. */
export async function setIntelligenceCardState(input: {
  creativeId: string;
  verdict: VerdictKind;
  businessId: string | null;
  state: "dismissed" | "snoozed" | "clear";
}): Promise<{ ok: boolean }> {
  const actor = await requireActor();
  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    if (input.state === "clear") {
      await client.query(
        `delete from public.intelligence_card_states
          where project_id = $1 and creative_id = $2 and verdict = $3
            and coalesce(business_project_id, $4::uuid) = $5::uuid`,
        [
          actor.projectId,
          input.creativeId,
          input.verdict,
          ZERO_UUID,
          scopeKey(input.businessId),
        ],
      );
    } else {
      const snoozeUntil =
        input.state === "snoozed"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : null;
      const updated = await client.query(
        `update public.intelligence_card_states
            set state = $4, snooze_until = $5, user_id = $6, updated_at = now()
          where project_id = $1 and creative_id = $2 and verdict = $3
            and coalesce(business_project_id, $7::uuid) = $8::uuid`,
        [
          actor.projectId,
          input.creativeId,
          input.verdict,
          input.state,
          snoozeUntil,
          actor.appUserId,
          ZERO_UUID,
          scopeKey(input.businessId),
        ],
      );
      if (updated.rowCount === 0) {
        await client.query(
          `insert into public.intelligence_card_states
             (organization_id, project_id, business_project_id, creative_id, verdict, state, snooze_until, user_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            actor.organizationId,
            actor.projectId,
            input.businessId,
            input.creativeId,
            input.verdict,
            input.state,
            snoozeUntil,
            actor.appUserId,
          ],
        );
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/inteligencia");
  return { ok: true };
}

/** Salva os limiares das regras do escopo (projeto de negocio ou geral). */
export async function saveIntelligenceSettings(input: {
  businessId: string | null;
  thresholds: Record<string, number>;
}): Promise<{ ok: boolean }> {
  const actor = await requireActor();
  const clean: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const value = Number(input.thresholds[key]);
    if (Number.isFinite(value) && value > 0) clean[key] = value;
  }
  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    const updated = await client.query(
      `update public.intelligence_settings
          set thresholds = $3::jsonb, updated_by_user_id = $4, updated_at = now()
        where project_id = $1
          and coalesce(business_project_id, $5::uuid) = $6::uuid`,
      [
        actor.projectId,
        null,
        JSON.stringify(clean),
        actor.appUserId,
        ZERO_UUID,
        scopeKey(input.businessId),
      ],
    );
    if (updated.rowCount === 0) {
      await client.query(
        `insert into public.intelligence_settings
           (organization_id, project_id, business_project_id, thresholds, updated_by_user_id)
         values ($1, $2, $3, $4::jsonb, $5)`,
        [
          actor.organizationId,
          actor.projectId,
          input.businessId,
          JSON.stringify(clean),
          actor.appUserId,
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/inteligencia");
  return { ok: true };
}
