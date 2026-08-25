import { describe, expect, it } from "vitest";
import { safeDashboardReturn } from "./safe-dashboard-return";

describe("safeDashboardReturn", () => {
  it("preserva rotas internas do painel", () => {
    expect(safeDashboardReturn("/dashboard/criativos?status=novo#item")).toBe(
      "/dashboard/criativos?status=novo#item",
    );
    expect(safeDashboardReturn("/dashboard")).toBe("/dashboard");
  });

  it.each([
    "https://example.com/dashboard",
    "//example.com/dashboard",
    "/dashboard.evil.example",
    "/dashboard@evil.example",
    "/dashboard\\@evil.example",
    "dashboard/criativos",
    "/login",
    "/dashboard\nLocation: https://example.com",
  ])("recusa retorno não confiável: %s", (value) => {
    expect(safeDashboardReturn(value)).toBe("/dashboard");
  });
});
