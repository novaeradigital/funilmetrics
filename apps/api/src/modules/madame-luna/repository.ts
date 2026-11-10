import type { Database, NewRawEvent } from "@funil-metrics/database";
import {
  connections,
  integrationSecrets,
  rawEvents,
  webhookEndpoints,
} from "@funil-metrics/database";
import { and, desc, eq, or } from "drizzle-orm";

export type MadameLunaEndpoint = {
  endpointId: string;
  connectionId: string;
  organizationId: string;
  projectId: string;
};

export type StoredMadameLunaSecret = {
  ciphertext: Buffer | null;
  initializationVector: Buffer | null;
  authenticationTag: Buffer | null;
  rotatedAt: Date | null;
};

export type RawEventReceipt = {
  id: string;
  duplicate: boolean;
};

export interface MadameLunaRepository {
  findActiveEndpoint(publicId: string): Promise<MadameLunaEndpoint | undefined>;
  findWebhookSecrets(
    projectId: string,
    connectionId: string,
  ): Promise<StoredMadameLunaSecret[]>;
  persistRawEvent(event: NewRawEvent): Promise<RawEventReceipt>;
  touchEndpoint(
    endpointId: string,
    connectionId: string,
    at: Date,
  ): Promise<void>;
}

export function createMadameLunaRepository(
  database: Database["db"],
): MadameLunaRepository {
  return {
    async findActiveEndpoint(publicId) {
      const [row] = await database
        .select({
          endpointId: webhookEndpoints.id,
          connectionId: connections.id,
          organizationId: connections.organizationId,
          projectId: connections.projectId,
        })
        .from(webhookEndpoints)
        .innerJoin(
          connections,
          eq(webhookEndpoints.connectionId, connections.id),
        )
        .where(
          and(
            eq(connections.publicId, publicId),
            eq(connections.provider, "madame_luna"),
            eq(connections.status, "active"),
          ),
        )
        .limit(1);

      return row;
    },

    async findWebhookSecrets(projectId, connectionId) {
      // Segredo atual (rotated_at nulo) e, durante a janela de troca, o
      // segredo anterior: os reenvios de entregas antigas do emissor da
      // Luna seguem assinados com o segredo velho.
      const previousValidSince = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      );
      const rows = await database
        .select({
          ciphertext: integrationSecrets.ciphertext,
          initializationVector: integrationSecrets.initializationVector,
          authenticationTag: integrationSecrets.authenticationTag,
          rotatedAt: integrationSecrets.rotatedAt,
        })
        .from(integrationSecrets)
        .where(
          and(
            eq(integrationSecrets.projectId, projectId),
            eq(integrationSecrets.provider, "madame_luna"),
            eq(integrationSecrets.kind, `webhook_token:${connectionId}`),
          ),
        )
        .orderBy(desc(integrationSecrets.createdAt))
        .limit(8);

      return rows
        .filter(
          (row) => !row.rotatedAt || row.rotatedAt >= previousValidSince,
        )
        .map((row) => ({
          ciphertext: row.ciphertext as Buffer | null,
          initializationVector: row.initializationVector as Buffer | null,
          authenticationTag: row.authenticationTag as Buffer | null,
          rotatedAt: row.rotatedAt,
        }));
    },

    async persistRawEvent(event) {
      const [inserted] = await database
        .insert(rawEvents)
        .values(event)
        .onConflictDoNothing()
        .returning({ id: rawEvents.id });

      if (inserted) {
        return { id: inserted.id, duplicate: false };
      }

      const conditions = [eq(rawEvents.idempotencyKey, event.idempotencyKey)];

      if (event.externalEventId) {
        conditions.push(eq(rawEvents.externalEventId, event.externalEventId));
      }

      const [existing] = await database
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.connectionId, event.connectionId),
            or(...conditions),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error("raw_event_conflict_without_existing_record");
      }

      return { id: existing.id, duplicate: true };
    },

    async touchEndpoint(endpointId, connectionId, at) {
      await Promise.all([
        database
          .update(webhookEndpoints)
          .set({ lastUsedAt: at, updatedAt: at })
          .where(eq(webhookEndpoints.id, endpointId)),
        database
          .update(connections)
          .set({ lastEventAt: at, updatedAt: at })
          .where(eq(connections.id, connectionId)),
      ]);
    },
  };
}
