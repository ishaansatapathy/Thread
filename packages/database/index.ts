import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "./env";
import * as schema from "./schema";
import * as relations from "./relations";

export const db = drizzle(env.DATABASE_URL, {
  schema: { ...schema, ...relations },
});
export * from "drizzle-orm";
export default db;
