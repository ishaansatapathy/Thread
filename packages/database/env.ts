import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).describe("Postgres URL — Neon pooled connection for the app"),
  DATABASE_URL_UNPOOLED: z
    .string()
    .min(1)
    .optional()
    .describe("Neon direct (non-pooler) URL — use for drizzle-kit migrate"),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
}

export const env = createEnv(process.env);
