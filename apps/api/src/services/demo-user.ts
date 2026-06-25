import { eq } from "@repo/database";
import db from "@repo/database";
import { usersTable } from "@repo/database/schema";

export const DEMO_THREAD_ID_PREFIX = "demo-thread-";

export function getDemoUserEmail(): string {
  return (process.env.DEMO_USER_EMAIL ?? process.env.SEED_USER_EMAIL ?? "demo@thread.dev")
    .trim()
    .toLowerCase();
}

export function isDemoFixtureThreadId(threadId: string): boolean {
  return threadId.startsWith(DEMO_THREAD_ID_PREFIX);
}

export async function isDemoUserId(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.email?.trim().toLowerCase() === getDemoUserEmail();
}

export function filterDemoFixtureThreads<T extends { id: string }>(
  threads: T[],
  demoOnly: boolean,
): T[] {
  if (!demoOnly) return threads;
  return threads.filter((thread) => isDemoFixtureThreadId(thread.id));
}
