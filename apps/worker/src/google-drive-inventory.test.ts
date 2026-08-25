import { describe, expect, it, vi } from "vitest";
import {
  isSupportedCreativeMime,
  listDriveFolder,
  validateImportExecution,
} from "./google-drive-inventory.js";

describe("Google Drive inventory", () => {
  it("aceita somente tipos previstos para criativos", () => {
    expect(isSupportedCreativeMime("image/png")).toBe(true);
    expect(isSupportedCreativeMime("video/mp4")).toBe(true);
    expect(isSupportedCreativeMime("text/plain")).toBe(true);
    expect(
      isSupportedCreativeMime("application/vnd.google-apps.document"),
    ).toBe(true);
    expect(isSupportedCreativeMime("application/zip")).toBe(false);
    expect(isSupportedCreativeMime("image/svg+xml")).toBe(false);
  });

  it("bloqueia lotes acima dos limites antes da importação", () => {
    const file = {
      id: "a",
      name: "A",
      mimeType: "video/mp4",
      modifiedTime: "2026-07-24T00:00:00Z",
      size: String(21 * 1024 ** 3),
    };
    expect(validateImportExecution([file])).toBe(
      "execution_size_limit_exceeded",
    );
    expect(validateImportExecution(Array.from({ length: 1_001 }, (_, index) => ({
      ...file,
      id: String(index),
      size: "1",
    })))).toBe("execution_file_limit_exceeded");
    expect(validateImportExecution(Array.from({ length: 11 }, (_, index) => ({
      ...file,
      id: String(index),
      size: undefined,
    })))).toBe("execution_size_limit_exceeded");
  });

  it("percorre todas as páginas usando field mask e bearer token", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [
              {
                id: "a",
                name: "A",
                mimeType: "image/png",
                modifiedTime: "2026-07-24T00:00:00Z",
              },
            ],
            nextPageToken: "next",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [
              {
                id: "b",
                name: "B",
                mimeType: "video/mp4",
                modifiedTime: "2026-07-24T00:00:00Z",
              },
            ],
          }),
        ),
      );
    const result = await listDriveFolder("folder", "token", request);
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "Bearer token",
    });
    expect(String(request.mock.calls[1]?.[0])).toContain("pageToken=next");
  });
});
