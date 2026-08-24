import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { cp, stat } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

const PDFJS_ASSET_DIRS = ["wasm", "cmaps", "standard_fonts", "iccs"];
const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".icc": "application/vnd.iccprofile",
};

// pdf.js fetches these at runtime, not through the bundler — without them a scanned page is blank
function pdfjsAssets(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (request, response, next) => {
        const relative = decodeURIComponent((request.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const file = path.join(root, relative);
        if (!PDFJS_ASSET_DIRS.some((dir) => file.startsWith(path.join(root, dir)))) return next();

        stat(file)
          .then((entry) => {
            if (!entry.isFile()) return next();
            response.setHeader("content-type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
            createReadStream(file).pipe(response);
          })
          .catch(next);
      });
    },
    async writeBundle(options) {
      const out = options.dir ?? "dist";
      for (const dir of PDFJS_ASSET_DIRS) {
        await cp(path.join(root, dir), path.join(out, "pdfjs", dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), pdfjsAssets()],
  server: {
    port: 3033,
    proxy: {
      "/trpc": "http://localhost:3034",
      // /chat is both the SPA page (GET, browser refresh) and the streaming API (POST)
      "/chat": {
        target: "http://localhost:3034",
        bypass: (req) => (req.method === "POST" ? undefined : "/index.html"),
      },
      "/translations": "http://localhost:3034",
      "/scripts": "http://localhost:3034",
      "/pdf": "http://localhost:3034",
      "/upload": "http://localhost:3034",
      "/download": "http://localhost:3034",
      "/audio": "http://localhost:3034",
      "/files": "http://localhost:3034",
      "/preview": "http://localhost:3034",
      "/read": "http://localhost:3034",
    },
  },
});
