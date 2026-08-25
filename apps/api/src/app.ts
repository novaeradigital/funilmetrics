import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { PRODUCT_NAME } from "@funil-metrics/domain";
import { createDatabase } from "@funil-metrics/database";
import {
  createLastlinkRepository,
  type LastlinkRepository,
} from "./modules/lastlink/repository.js";
import { registerLastlinkRoutes } from "./modules/lastlink/routes.js";
import {createTrackingRepository} from "./modules/tracking/repository.js";
import type {TrackingRepository} from "./modules/tracking/repository.js";
import {registerTrackingRoutes} from "./modules/tracking/routes.js";
import {registerEdgeRedirectRoutes} from "./modules/edge-redirect/routes.js";

type BuildAppOptions = {
  lastlinkRepository?: LastlinkRepository;
  trackingRepository?: TrackingRepository;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.x-lastlink-token",
          "req.body",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      {
        errorType: error instanceof Error ? error.name : "UnknownError",
        requestId: request.id,
      },
      "unhandled request error",
    );

    return reply.status(500).send({
      error: "internal_error",
      requestId: request.id,
    });
  });

  app.get("/health", async () => ({
    service: `${PRODUCT_NAME} API`,
    status: "ok",
  }));

  let database: ReturnType<typeof createDatabase> | undefined;
  let lastlinkRepository = options.lastlinkRepository;
  let trackingRepository=options.trackingRepository;

  if (!lastlinkRepository && process.env.DATABASE_URL) {
    database = createDatabase(process.env.DATABASE_URL, {
      sslCa: process.env.DATABASE_SSL_CA_FILE
        ? readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8")
        : undefined,
      sslRejectUnauthorized:
        process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
          ? false
          : undefined,
    });
    lastlinkRepository = createLastlinkRepository(database.db);
    trackingRepository=createTrackingRepository(database.pool);
    void registerEdgeRedirectRoutes(app,database.pool);
  }

  if (lastlinkRepository) {
    void registerLastlinkRoutes(app, lastlinkRepository);
  }
  if(trackingRepository)void registerTrackingRoutes(app,trackingRepository);

  if (database) {
    app.addHook("onClose", async () => {
      await database?.close();
    });
  }

  return app;
}
