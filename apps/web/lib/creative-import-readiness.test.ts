import { describe, expect, it } from "vitest";
import { creativeImportReadiness } from "./creative-import-readiness.js";

describe("creative import readiness", () => {
  it("exige primeiro o armazenamento privado", () => {
    expect(
      creativeImportReadiness({
        storageReady: false,
        antimalwareReady: false,
      }),
    ).toEqual({ ready: false, error: "r2_validation_required" });
  });

  it("exige antimalware depois do armazenamento", () => {
    expect(
      creativeImportReadiness({
        storageReady: true,
        antimalwareReady: false,
      }),
    ).toEqual({ ready: false, error: "clamav_validation_required" });
  });

  it("libera somente quando os dois controles estão prontos", () => {
    expect(
      creativeImportReadiness({
        storageReady: true,
        antimalwareReady: true,
      }),
    ).toEqual({ ready: true, error: null });
  });
});
