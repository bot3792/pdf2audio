import type { FastifyServerOptions } from "fastify";

export function createFastifyOptions(): FastifyServerOptions {
  return {
    logger: true,
    disableRequestLogging: true,
    maxParamLength: 300,
    // Bulk chapter imports via /api/books ship multi-MB JSON bodies
    bodyLimit: 32 * 1024 * 1024,
  };
}
