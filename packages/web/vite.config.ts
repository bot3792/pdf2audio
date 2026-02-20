import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 3033,
    proxy: {
      "/trpc": "http://localhost:3034",
      "/upload": "http://localhost:3034",
      "/download": "http://localhost:3034",
      "/audio": "http://localhost:3034",
      "/files": "http://localhost:3034",
      "/preview": "http://localhost:3034",
    },
  },
});
