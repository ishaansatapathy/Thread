import "dotenv/config";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Client } from "pg";

import { usersTable } from "../models/user";

const SALT_ROUNDS = 12;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const email = process.env.SEED_USER_EMAIL ?? "demo@thread.dev";
  const password = process.env.SEED_DEMO_PASSWORD ?? "DemoPass123!";
  const fullName = "Thread Demo";

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const db = drizzle(client);

  try {
    const existing = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[seed] Demo user already exists: ${email} — skipping.`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [user] = await db
      .insert(usersTable)
      .values({
        fullName,
        email,
        passwordHash,
        authProvider: "local",
        // Pre-verified so demo login works without email step.
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpire: null,
        role: "user",
        tokenVersion: "0",
        autoApproveEmail: false,
        autoApproveAgentEmail: false,
        autoApproveCalendar: false,
      })
      .returning({ id: usersTable.id, email: usersTable.email });

    console.log(`[seed] Demo user created:`);
    console.log(`       email:    ${user?.email}`);
    console.log(`       password: ${password}`);
    console.log(`       id:       ${user?.id}`);
    console.log(`[seed] Done.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
