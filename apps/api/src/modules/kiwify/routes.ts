import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KiwifyRepository } from "./repository.js";
import { createKiwifyReceiver } from "./service.js";

const paramsSchema = z.object({
  connectionPublicId: z.uuid(),
});

const querySchema = z.object({
  signature: z.string().optional(),
});

export async function registerKiwifyRoutes(
  app: FastifyInstance,
  repository: KiwifyRepository,
) {
  const receiveKiwify = createKiwifyReceiver(repository);

  await app.register(async (webhookApp) => {
    webhookApp.removeContentTypeParser("application/json");
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );

    webhookApp.post<{
      Params: { connectionPublicId: string };
      Querystring: { signature?: string };
      Body: Buffer;
    }>("/webhooks/kiwify/:connectionPublicId", async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send({ status: "not_found" });
      }
      const query = querySchema.safeParse(request.query ?? {});

      const result = await receiveKiwify({
        connectionPublicId: params.data.connectionPublicId,
        body: request.body,
        signature: query.success ? query.data.signature : undefined,
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
