import { describe, expect, it } from "vitest";
import { shouldRefreshOAuthToken } from "./meta-token.js";

const now = new Date("2026-10-30T12:00:00Z");
const days = (value: number) =>
  new Date(now.getTime() + value * 86_400_000);

describe("shouldRefreshOAuthToken", () => {
  it("sem data de validade não renova", () => {
    expect(shouldRefreshOAuthToken(null, now)).toBe(false);
  });

  it("token já vencido não entra na renovação preventiva", () => {
    expect(shouldRefreshOAuthToken(days(-1), now)).toBe(false);
  });

  it("dentro da janela de 15 dias renova", () => {
    expect(shouldRefreshOAuthToken(days(10), now)).toBe(true);
    expect(shouldRefreshOAuthToken(days(15), now)).toBe(true);
  });

  it("longe do vencimento não renova", () => {
    expect(shouldRefreshOAuthToken(days(40), now)).toBe(false);
  });
});
