import type { FastifyServerOptions } from "fastify";

export function createFastifyOptions(): FastifyServerOptions {
  return {
    logger: true,
    disableRequestLogging: true,
    maxParamLength: 300,
  };
}
