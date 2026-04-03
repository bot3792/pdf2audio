import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: "./test/global-setup.ts",
    setupFiles: ["./test/setup.ts"],
  },
});
