import { describe, expect, it } from "vitest";

import { createFastifyOptions } from "./fastify-config.ts";

describe("createFastifyOptions", () => {
  it("disables Fastify request logging so worker diagnostics stay readable", () => {
    expect(createFastifyOptions()).toMatchObject({
      logger: true,
      disableRequestLogging: true,
      maxParamLength: 300,
    });
  });
});
