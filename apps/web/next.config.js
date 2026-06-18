import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(configDir, "../..");

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: monorepoRoot,
  },
  async rewrites() {
    return [
      {
        source: "/api-auth/:path*",
        destination: `${apiInternalUrl}/auth/:path*`,
      },
      {
        source: "/api-connect/:path*",
        destination: `${apiInternalUrl}/auth/corsair/:path*`,
      },
      {
        source: "/agent/stream",
        destination: `${apiInternalUrl}/agent/stream`,
      },
      {
        source: "/mcp",
        destination: `${apiInternalUrl}/mcp`,
      },
      {
        source: "/mcp/corsair",
        destination: `${apiInternalUrl}/mcp/corsair`,
      },
      {
        source: "/corsair/permissions/:path*",
        destination: `${apiInternalUrl}/corsair/permissions/:path*`,
      },
      {
        source: "/api/corsair/:path*",
        destination: `${apiInternalUrl}/api/corsair/:path*`,
      },
      {
        source: "/sync/events",
        destination: `${apiInternalUrl}/sync/events`,
      },
      {
        source: "/inbox/attachments/:path*",
        destination: `${apiInternalUrl}/inbox/attachments/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
