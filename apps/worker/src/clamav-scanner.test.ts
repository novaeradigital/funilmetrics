import { describe, expect, it } from "vitest";
import {
  loadClamAvConfig,
  parseClamAvResponse,
} from "./clamav-scanner.js";

describe("ClamAV scanner", () => {
  it("fica desativado sem configuração e rejeita valores inválidos", () => {
    expect(loadClamAvConfig({})).toBeNull();
    expect(() =>
      loadClamAvConfig({ CLAMAV_HOST: "scanner", CLAMAV_PORT: "invalid" }),
    ).toThrow("clamav_configuration_invalid");
  });

  it("carrega limites explícitos", () => {
    expect(
      loadClamAvConfig({
        CLAMAV_HOST: "scanner.internal",
        CLAMAV_PORT: "3310",
        CLAMAV_TIMEOUT_MS: "30000",
        CLAMAV_MAX_BYTES: "1048576",
      }),
    ).toEqual({
      host: "scanner.internal",
      port: 3310,
      timeoutMs: 30000,
      maxBytes: 1048576,
    });
  });

  it("interpreta limpo, infectado e resposta inesperada sem expor texto livre", () => {
    expect(parseClamAvResponse("stream: OK\0")).toEqual({ status: "clean" });
    expect(parseClamAvResponse("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      status: "infected",
      threat: "Eicar-Test-Signature",
    });
    expect(parseClamAvResponse("temporary daemon failure")).toEqual({
      status: "failed_retryable",
      code: "clamav_unexpected_response",
    });
  });
});
