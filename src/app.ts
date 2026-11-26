import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyError, type FastifyReply } from "fastify";
import { AppError } from "./errors.js";
import { registerRoutes } from "./routes.js";
import { seed } from "./seed.js";
import { createService } from "./service.js";
import { createStore } from "./store.js";

// `now` is injectable so tests can fake the clock.
export function buildApp({ now = () => new Date() }: { now?: () => Date } = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  const store = createStore();
  seed(store, now);
  const service = createService(store, now);

  // Every error leaves the API in the same shape: { error: { code, message } }.
  const sendError = (reply: FastifyReply, status: number, code: string, message: string) =>
    reply.code(status).send({ error: { code, message } });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) return sendError(reply, error.status, error.code, error.message);
    if (error.validation) return sendError(reply, 400, "VALIDATION_ERROR", error.message);
    // Other client errors Fastify finds itself, e.g. broken JSON (400) or a body without
    // "content-type: application/json" (415).
    if (error.statusCode && error.statusCode < 500) {
      const code = error.statusCode === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "BAD_REQUEST";
      return sendError(reply, error.statusCode, code, error.message);
    }
    request.log.error(error);
    return sendError(reply, 500, "INTERNAL_ERROR", "Something went wrong");
  });
  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, "NOT_FOUND", "Route not found"),
  );

  app.register(swagger, {
    openapi: {
      info: {
        title: "Parent-teacher conferences",
        version: "1.0.0",
        description:
          "Click Authorize and enter a seeded user id, for example parent-1 or teacher-1. See README.md for all ids.",
      },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      security: [{ bearerAuth: [] }],
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  // Routes live in their own scope so the login check does not apply to /docs.
  app.register(async (scope) => registerRoutes(scope, store, service));

  return app;
}
