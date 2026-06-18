/**
 * Vercel ESM bundle shim — same sync API as corsair-imports.ts.
 * Original file is unchanged; tsup aliases it only for the vercel.mjs build.
 */
type CorsairOAuthModule = typeof import("corsair/oauth");
type CorsairSetupModule = typeof import("corsair/setup");

let oauthModule: CorsairOAuthModule | null = null;
let setupModule: CorsairSetupModule | null = null;
let preloadPromise: Promise<void> | null = null;

export async function preloadCorsairImportModules(): Promise<void> {
  if (oauthModule && setupModule) return;
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const [oauth, setup] = await Promise.all([
        import("corsair/oauth"),
        import("corsair/setup"),
      ]);
      oauthModule = oauth;
      setupModule = setup;
    })();
  }
  await preloadPromise;
}

export function getCorsairOAuthModule(): CorsairOAuthModule {
  oauthModule ??= loadCorsairModule<CorsairOAuthModule>("oauth.js");
  return oauthModule;
}

export function getCorsairSetupModule(): CorsairSetupModule {
  setupModule ??= loadCorsairModule<CorsairSetupModule>("setup.js");
  return setupModule;
}

function loadCorsairModule<T>(_subpath: string): T {
  throw new Error(
    "Corsair submodule used before preload — call preloadCorsairImportModules() during serverless boot",
  );
}
