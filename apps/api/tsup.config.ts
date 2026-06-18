import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts", "./src/server.ts", "./src/api-bootstrap.ts", "./src/vercel.ts"],
  external: [/^@scalar\//],
  noExternal: [/^@repo\//],
  splitting: false,
  bundle: true,
  outDir: "./dist",
  clean: true,
  env: { IS_SERVER_BUILD: "true" },
  loader: { ".json": "copy" },
  minify: true,
  sourcemap: false,
});
