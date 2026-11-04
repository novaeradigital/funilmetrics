import { describe, expect, it, vi } from "vitest";
import {
  buildMetaEventPayload,
  processMetaEventBatch,
  type MetaQueueRow,
} from "./meta-event-dispatcher.js";

const baseRow: MetaQueueRow = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  project_id: "33333333-3333-4333-8333-333333333333",
  business_project_id: "44444444-4444-4444-8444-444444444444",
  pixel_id: "123456789012345",
  event_name: "Purchase",
  event_id: "fm-purchase-abc",
  event_time: new Date("2026-11-04T15:00:00.000Z"),
  event_source_url: "https://example.com/obrigado",
  user_data: { fbp: "fb.1.1.2", em: ["hash"] },
  custom_data: { value: 19.9, currency: "BRL" },
  attempts: 1,
};

function fakePool(rows: MetaQueueRow[], configActive = true) {
  const updates: Array<{ status: string; id: string }> = [];
  const pool = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("for update skip locked")) {
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("business_meta_pixels")) {
        return {
          rows: [{ active: configActive, test_event_code: "TEST123" }],
          rowCount: 1,
        };
      }
      if (sql.includes("update public.meta_event_queue")) {
        updates.push({ id: String(values?.[0]), status: String(values?.[1]) });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    }),
  };
  return { pool: pool as never, updates };
}

describe("buildMetaEventPayload", () => {
  it("monta o payload CAPI com event_time em segundos e test code", () => {
    const payload = buildMetaEventPayload(baseRow, "TEST123");
    expect(payload.test_event_code).toBe("TEST123");
    const data = payload.data as Array<Record<string, unknown>>;
    expect(data[0]).toMatchObject({
      event_name: "Purchase",
      event_id: "fm-purchase-abc",
      event_time: 1793804400,
      action_source: "website",
      event_source_url: "https://example.com/obrigado",
    });
    expect(data[0]!.user_data).toEqual({ fbp: "fb.1.1.2", em: ["hash"] });
    expect(data[0]!.custom_data).toEqual({ value: 19.9, currency: "BRL" });
  });

  it("omite user_data e custom_data vazios", () => {
    const payload = buildMetaEventPayload({
      ...baseRow,
      user_data: {},
      custom_data: {},
      event_source_url: null,
    });
    const data = payload.data as Array<Record<string, unknown>>;
    expect(data[0]).not.toHaveProperty("user_data");
    expect(data[0]).not.toHaveProperty("custom_data");
    expect(data[0]).not.toHaveProperty("event_source_url");
    expect(payload).not.toHaveProperty("test_event_code");
  });
});

describe("processMetaEventBatch", () => {
  it("envia e marca como sent com a resposta da Graph", async () => {
    const { pool, updates } = fakePool([baseRow]);
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "trace-1" }),
        { status: 200 },
      ),
    );
    const summary = await processMetaEventBatch(pool, 25, 5, {
      fetchImpl: fetchImpl as never,
      loadToken: async () => "token-secreto",
    });
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    expect(updates).toEqual([{ id: baseRow.id, status: "sent" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toContain("/v21.0/123456789012345/events");
    expect(url).toContain("access_token=token-secreto");
    expect(JSON.parse(init.body).test_event_code).toBe("TEST123");
  });

  it("marca como failed quando a Graph rejeita e ainda ha tentativas", async () => {
    const { pool, updates } = fakePool([baseRow]);
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "Invalid parameter" } }),
        { status: 400 },
      ),
    );
    const summary = await processMetaEventBatch(pool, 25, 5, {
      fetchImpl: fetchImpl as never,
      loadToken: async () => "token-secreto",
    });
    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
    expect(updates[0]?.status).toBe("failed");
  });

  it("marca como dead quando as tentativas esgotam", async () => {
    const { pool, updates } = fakePool([{ ...baseRow, attempts: 5 }]);
    const summary = await processMetaEventBatch(pool, 25, 5, {
      fetchImpl: vi.fn() as never,
      loadToken: async () => null,
    });
    expect(summary).toMatchObject({ claimed: 1, dead: 1 });
    expect(updates[0]?.status).toBe("dead");
  });

  it("bloqueia quando o pixel do negocio esta inativo", async () => {
    const { pool, updates } = fakePool([baseRow], false);
    const summary = await processMetaEventBatch(pool, 25, 5, {
      fetchImpl: vi.fn() as never,
      loadToken: async () => "token-secreto",
    });
    expect(summary).toMatchObject({ claimed: 1, blocked: 1 });
    expect(updates[0]?.status).toBe("blocked");
  });
});
