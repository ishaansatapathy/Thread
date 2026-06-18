import { createRequire } from "node:module";
import path from "node:path";

/**
 * tsx compiles the API to CJS, which breaks subpath imports from the ESM-only
 * `corsair` package (they resolve to `.d.ts` stubs). Load the compiled JS directly.
 */
const corsairRequire = createRequire(__filename);

function loadCorsairModule<T>(subpath: string): T {
  const entryPath = corsairRequire.resolve("corsair");
  return corsairRequire(path.join(path.dirname(entryPath), subpath)) as T;
}

type CorsairOAuthModule = typeof import("corsair/oauth");
type CorsairSetupModule = typeof import("corsair/setup");

let oauthModule: CorsairOAuthModule | null = null;
let setupModule: CorsairSetupModule | null = null;

export function getCorsairOAuthModule(): CorsairOAuthModule {
  oauthModule ??= loadCorsairModule<CorsairOAuthModule>("oauth.js");
  return oauthModule;
}

export function getCorsairSetupModule(): CorsairSetupModule {
  setupModule ??= loadCorsairModule<CorsairSetupModule>("setup.js");
  return setupModule;
}
