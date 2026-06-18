import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const corsairImportsEsm = path.join(apiRoot, "src/corsair-imports-esm.ts");

const shared = {
  splitting: false as const,
  bundle: true,
  env: { IS_SERVER_BUILD: "true" },
  loader: { ".json": "copy" as const },
  minify: false,
  sourcemap: false,
  target: "es2022" as const,
};

export default defineConfig([
  {
    ...shared,
    entry: ["./src/index.ts", "./src/server.ts", "./src/api-bootstrap.ts"],
    format: "cjs",
    outDir: "./dist",
    clean: true,
    noExternal: [/^@repo\//],
    external: [],
  },
  {
    ...shared,
    entry: ["./src/vercel.ts"],
    format: "esm",
    outDir: "./dist",
    outExtension({ format }) {
      return { js: format === "esm" ? ".mjs" : ".js" };
    },
    clean: false,
    platform: "node",
    noExternal: [/^@repo\//],
    external: [
      "corsair",
      /^@corsair-dev\//,
      "@anthropic-ai/claude-agent-sdk",
      "@mastra/core/tools",
      "@ai-sdk/mcp",
    ],
    esbuildPlugins: [
      {
        name: "corsair-imports-esm-alias",
        setup(build) {
          build.onResolve({ filter: /corsair-imports$/ }, () => ({
            path: corsairImportsEsm,
          }));
        },
      },
    ],
    banner: {
      js: 'import { createRequire as __createRequire } from "module";import { fileURLToPath as __fileURLToPath } from "url";import { dirname as __pathDirname } from "path";const require=__createRequire(import.meta.url);const __filename=__fileURLToPath(import.meta.url);const __dirname=__pathDirname(__filename);',
    },
  },
]);
