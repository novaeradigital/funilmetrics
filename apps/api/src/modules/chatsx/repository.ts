import type { Database, NewRawEvent } from "@funil-metrics/database";
import {
  connections,
  rawEvents,
  webhookEndpoints,
} from "@funil-metrics/database";
import { and, eq, or } from "drizzle-orm";

export type ChatsxEndpoint = {
  endpointId: string;
  connectionId: string;
  organizationId: string;
  projectId: string;
  tokenHash: string;
  previousTokenHash: string | null;
  previousTokenValidUntil: Date | null;
};

export type RawEventReceipt = {
  id: string;
  duplicate: boolean;
};

export interface ChatsxRepository {
  findActiveEndpoint(publicId: string): Promise<ChatsxEndpoint | undefined>;
  persistRawEvent(event: NewRawEvent): Promise<RawEventReceipt>;
  touchEndpoint(endpointId: string, connectionId: string, at: Date): Promise<void>;
}

export function createChatsxRepository(database: Database["db"]): ChatsxRepository {
  return {
    async findActiveEndpoint(publicId) {
      const [row] = await database
        .select({
          endpointId: webhookEndpoints.id,
          connectionId: connections.id,
          organizationId: connections.organizationId,
          projectId: connections.projectId,
          tokenHash: webhookEndpoints.tokenHash,
          previousTokenHash: webhookEndpoints.previousTokenHash,
          previousTokenValidUntil: webhookEndpoints.previousTokenValidUntil,
        })
        .from(webhookEndpoints)
        .innerJoin(
          connections,
          eq(webhookEndpoints.connectionId, connections.id),
        )
        .where(
          and(
            eq(connections.publicId, publicId),
            eq(connections.provider, "chatsx"),
            eq(connections.status, "active"),
          ),
        )
        .limit(1);

      return row;
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

      const conditions = [
        eq(rawEvents.idempotencyKey, event.idempotencyKey),
      ];

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
