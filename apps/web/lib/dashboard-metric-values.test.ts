import { describe, expect, it, vi } from "vitest";
import type { Database } from "@funil-metrics/database";
import { loadDashboardMetricValues } from "./dashboard-metric-values";

describe("dashboard metric filters", () => {
  it("compara o enum de status de pagamento como texto", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            gross_revenue: "0",
            net_revenue: "0",
            approved_payments: 0,
            pending_payments: 0,
            reversed_payments: 0,
            eligible_events: 0,
            covered_events: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            spend: "0",
            impressions: "0",
            clicks: "0",
            currency: null,
            rows: 0,
            converted_rows: 0,
            blocked_rows: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            link_clicks: "0",
            landing_page_views: "0",
            view_content: "0",
            add_to_cart: "0",
            initiate_checkout: "0",
            action_rows: 0,
          },
        ],
      });
    const database = { pool: { query } } as unknown as Database;

    await loadDashboardMetricValues(database, "project-id", 30, {
      paymentStatus: "approved",
    });

    expect(query.mock.calls[0]?.[0]).toContain(
      "filtered_payment.status::text=$12",
    );
  });
});
