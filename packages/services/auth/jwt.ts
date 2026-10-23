import jwt from "jsonwebtoken";
import type { Response } from "express";

import { env } from "../env";
import { getClearJwtCookieOptions, getJwtCookieOptions } from "./jwt-cookie-options";

import type { UserRole } from "./roles";

const refreshSecret = () => env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;
const JWT_ALGORITHMS = ["HS256"] as const;

export type AccessTokenPayload = {
  userId: string;
  emailVerified: boolean;
  role: UserRole;
};
export type RefreshTokenPayload = {
  userId: string;
  type: "refresh";
  emailVerified: boolean;
  role: UserRole;
  tokenVersion: string;
};

export type AuthTokenUser = {
  id: string;
  emailVerified: boolean;
  role: UserRole;
  tokenVersion: string;
};

export function issueAuthCookies(res: Response, user: AuthTokenUser) {
  const accessToken = jwt.sign(
    {
      userId: user.id,
      emailVerified: user.emailVerified,
      role: user.role,
    } satisfies AccessTokenPayload,
    env.JWT_SECRET,
    {
      expiresIn: "15m",
      algorithm: "HS256",
    },
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      type: "refresh",
      emailVerified: user.emailVerified,
      role: user.role,
      tokenVersion: user.tokenVersion,
    } satisfies RefreshTokenPayload,
    refreshSecret(),
    { expiresIn: "30d", algorithm: "HS256" },
  );

  const baseOpts = getJwtCookieOptions();

  res.cookie("jwt", accessToken, {
    ...baseOpts,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("jwt_refresh", refreshToken, {
    ...baseOpts,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookies(res: Response) {
  const clearOpts = getClearJwtCookieOptions();
  res.clearCookie("jwt", clearOpts);
  res.clearCookie("jwt_refresh", clearOpts);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: [...JWT_ALGORITHMS] }) as AccessTokenPayload;
}

export type ExtensionTokenPayload = {
  userId: string;
  type: "extension";
  tokenVersion: string;
};

export const EXTENSION_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Separate secret so an extension token can never be replayed as a session cookie (or vice versa). */
const extensionSecret = () => `${env.JWT_SECRET}:thread-extension`;

/** Bearer token for the Thread browser extension; revoked with the user's other sessions via tokenVersion. */
export function issueExtensionToken(user: Pick<AuthTokenUser, "id" | "tokenVersion">) {
  const token = jwt.sign(
    { userId: user.id, type: "extension", tokenVersion: user.tokenVersion } satisfies ExtensionTokenPayload,
    extensionSecret(),
    { expiresIn: EXTENSION_TOKEN_TTL_SECONDS, algorithm: "HS256" },
  );
  return { token, expiresAt: new Date(Date.now() + EXTENSION_TOKEN_TTL_SECONDS * 1000).toISOString() };
}

export function verifyExtensionToken(token: string): ExtensionTokenPayload {
  const decoded = jwt.verify(token, extensionSecret(), { algorithms: [...JWT_ALGORITHMS] }) as ExtensionTokenPayload;
  if (decoded.type !== "extension") throw new Error("Invalid token type");
  return decoded;
}

export function readBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  return match?.[1] ?? null;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, refreshSecret(), {
    algorithms: [...JWT_ALGORITHMS],
  }) as RefreshTokenPayload;
  if (decoded.type !== "refresh") {
    throw new Error("Invalid token type");
  }
  return decoded;
}
