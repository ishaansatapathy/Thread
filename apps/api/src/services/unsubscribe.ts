import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { UnsubscribeInfo } from "@repo/services/inbox";

/**
 * Parses RFC 2369 List-Unsubscribe (+ RFC 8058 List-Unsubscribe-Post) into the best
 * way to leave the list without the user visiting a website.
 */
export function parseListUnsubscribe(listUnsubscribe?: string, listUnsubscribePost?: string): UnsubscribeInfo {
  if (!listUnsubscribe) return { method: "none" };
  const entries = Array.from(listUnsubscribe.matchAll(/<([^>]+)>/g), (m) => m[1]!.trim());
  const https = entries.find((e) => /^https:\/\//i.test(e));
  const mailtoRaw = entries.find((e) => /^mailto:/i.test(e));
  const oneClick = /List-Unsubscribe\s*=\s*One-Click/i.test(listUnsubscribePost ?? "");

  if (https && oneClick) return { method: "one_click", url: https };

  if (mailtoRaw) {
    try {
      const parsed = new URL(mailtoRaw);
      const to = decodeURIComponent(parsed.pathname).split(",")[0]?.trim() ?? "";
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return {
          method: "mailto",
          url: https,
          mailto: {
            to,
            subject: parsed.searchParams.get("subject")?.slice(0, 200) || "unsubscribe",
            body: parsed.searchParams.get("body")?.slice(0, 1000) || "Please unsubscribe me from this mailing list.",
          },
        };
      }
    } catch {
      // malformed mailto — fall through to the website option
    }
  }

  if (https) return { method: "website", url: https };
  return { method: "none" };
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

/** Only public https hosts on the default port — the URL comes from an email header. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Unsubscribe link must use https");
  if (url.port && url.port !== "443") throw new Error("Unsubscribe link uses an unexpected port");
  if (url.username || url.password) throw new Error("Unsubscribe link contains credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("Unsubscribe link points to a private network");
  }
  return url;
}

/** RFC 8058 one-click: a single POST, no redirects followed, no cookies. */
export async function postOneClickUnsubscribe(raw: string): Promise<boolean> {
  const url = await assertPublicHttpsUrl(raw);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Thread-Unsubscribe/1.0" },
    body: "List-Unsubscribe=One-Click",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  return res.status < 400;
}
