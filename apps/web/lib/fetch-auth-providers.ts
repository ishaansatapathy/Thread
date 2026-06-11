import type { RouterOutputs } from "@repo/trpc/client";

type AuthProvider = RouterOutputs["auth"]["getSupportedAuthenticationProviders"][number];

function getTrpcBaseUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/trpc`;
  }
  const apiBase = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  return `${apiBase}/trpc`;
}

export async function fetchAuthProviders(): Promise<AuthProvider[]> {
  try {
    const response = await fetch(
      `${getTrpcBaseUrl()}/auth.getSupportedAuthenticationProviders?input=%7B%7D`,
      {
        cache: "no-store",
        credentials: "include",
      },
    );
    if (!response.ok) return [];

    const payload: unknown = await response.json();
    const data = (payload as { result?: { data?: AuthProvider[] } }).result?.data;
    return data ?? [];
  } catch {
    return [];
  }
}

export function getGoogleProvider(providers: AuthProvider[]) {
  return providers.find((provider) => provider.provider === "GOOGLE_OAUTH");
}
