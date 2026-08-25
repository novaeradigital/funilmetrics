import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("confirma que a API está saudável", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });
});

