import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MadameLunaRepository } from "./repository.js";
import { createMadameLunaReceiver } from "./service.js";

const paramsSchema = z.object({
  connectionPublicId: z.uuid(),
});

export async function registerMadameLunaRoutes(
  app: FastifyInstance,
  repository: MadameLunaRepository,
) {
  const receiveMadameLuna = createMadameLunaReceiver(repository);

  await app.register(async (webhookApp) => {
    webhookApp.removeContentTypeParser("application/json");
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );

    webhookApp.post<{
      Params: { connectionPublicId: string };
      Body: Buffer;
    }>("/webhooks/madame-luna/:connectionPublicId", async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send({ status: "not_found" });
      }

      const headerSignature = request.headers["x-madame-luna-signature"];
      const result = await receiveMadameLuna({
        connectionPublicId: params.data.connectionPublicId,
        body: request.body,
        signature: Array.isArray(headerSignature)
          ? headerSignature[0]
          : headerSignature,
        contentType: request.headers["content-type"] ?? "",
        method: request.method,
        allowedHeaders: {
          "content-length": request.headers["content-length"],
          "content-type": request.headers["content-type"],
          "user-agent": request.headers["user-agent"],
        },
      });

      switch (result.kind) {
        case "not_found":
          return reply.code(404).send({ status: "not_found" });
        case "unauthorized":
          return reply.code(401).send({ status: "unauthorized" });
        case "invalid_json":
          return reply.code(400).send({
            status: "quarantined",
            receiptId: result.receiptId,
          });
        case "accepted":
          return reply
            .code(result.receipt.duplicate ? 200 : 202)
            .send({
              status: result.receipt.duplicate ? "duplicate" : "accepted",
              receiptId: result.receipt.id,
            });
      }
    });
  });
}
