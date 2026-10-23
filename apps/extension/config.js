// Thread web apps this extension may connect to. Keep in sync with manifest.json
// (host_permissions + externally_connectable) when adding a domain.
export const THREAD_ORIGINS = [
  { label: "Thread", origin: "https://thread.ishaandev.co.in" },
  { label: "Local dev (localhost:3000)", origin: "http://localhost:3000" },
];

const ALLOWED = [/^http:\/\/localhost:3000$/, /^https:\/\/thread-web\.vercel\.app$/, /^https:\/\/([a-z0-9-]+\.)*ishaandev\.co\.in$/];

export function isAllowedOrigin(origin) {
  return typeof origin === "string" && ALLOWED.some((re) => re.test(origin));
}

export const MEET_CODE_RE = /^https:\/\/meet\.google\.com\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})(?:[/?#]|$)/i;

export function meetCodeFromUrl(url) {
  return typeof url === "string" ? (url.match(MEET_CODE_RE)?.[1]?.toLowerCase() ?? null) : null;
}
