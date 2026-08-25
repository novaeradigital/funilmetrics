import { describe, expect, it, vi } from "vitest";
import { isClamAvPong } from "./clamav-check.js";

vi.mock("server-only", () => ({}));

describe("ClamAV connection check", () => {
  it("aceita somente a resposta PONG do daemon", () => {
    expect(isClamAvPong("PONG\0")).toBe(true);
    expect(isClamAvPong("ERROR\0")).toBe(false);
    expect(isClamAvPong("PONG extra")).toBe(false);
  });
});
