import { describe, expect, it } from "vitest";
import { hashWebhookToken, verifyWebhookToken } from "./token.js";

describe("token de webhook", () => {
  it("armazena hash com salt e compara sem guardar o segredo", async () => {
    const token = "secret-token";
    const hash = await hashWebhookToken(token);

    expect(hash).not.toContain(token);
    await expect(verifyWebhookToken(token, hash)).resolves.toBe(true);
    await expect(verifyWebhookToken("wrong-token", hash)).resolves.toBe(false);
  });
});
