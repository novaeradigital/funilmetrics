import { describe, expect, it } from "vitest";
import { getWorkerStatus } from "./index.js";

describe("worker", () => {
  it("inicia com driver de desenvolvimento", () => {
    expect(getWorkerStatus()).toMatchObject({
      status: "ready",
      queueDriver: "memory",
      objectStorage: "disabled",
      antimalware: "disabled",
    });
  });
});
