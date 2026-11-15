import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatsxRepository } from "./repository.js";
import { createChatsxReceiver } from "./service.js";

const paramsSchema = z.object({
  connectionPublicId: z.uuid(),
});

export async function registerChatsxRoutes(
  app: FastifyInstance,
  repository: ChatsxRepository,
) {
  const receiveChatsx = createChatsxReceiver(repository);

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
    }>("/webhooks/chatsx/:connectionPublicId", async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send({ status: "not_found" });
      }

      const result = await receiveChatsx({
        connectionPublicId: params.data.connectionPublicId,
        token:
          typeof request.headers["x-chatsx-token"] === "string"
            ? request.headers["x-chatsx-token"]
            : undefined,
        body: request.body,
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
