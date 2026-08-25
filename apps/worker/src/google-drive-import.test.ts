import { describe, expect, it } from "vitest";
import { creativeFormat } from "./google-drive-import.js";

describe("Google Drive creative import", () => {
  it("aplica formatos e limites aprovados", () => {
    expect(creativeFormat("image/png")?.maxBytes).toBe(50 * 1024 ** 2);
    expect(creativeFormat("video/mp4")?.maxBytes).toBe(2 * 1024 ** 3);
    expect(creativeFormat("text/plain")?.maxBytes).toBe(10 * 1024 ** 2);
    expect(creativeFormat("application/zip")).toBeNull();
  });

  it("exporta Google Docs para DOCX sem confundir o MIME original", () => {
    expect(
      creativeFormat("application/vnd.google-apps.document"),
    ).toMatchObject({
      outputMime:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      maxBytes: 10 * 1024 ** 2,
    });
  });
});
