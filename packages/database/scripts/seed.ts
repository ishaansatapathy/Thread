import "dotenv/config";
import bcrypt from "bcryptjs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Client } from "pg";

import { usersTable } from "../models/user";
import { threadQueueItemsTable } from "../models/queue-item";
import { threadMailCacheTable } from "../models/mail-cache";

const SALT_ROUNDS = 12;

const DEMO_MAIL_FIXTURES = [
  {
    threadId: "demo-thread-welcome",
    subject: "Welcome to Thread — Hackathon demo inbox",
    fromName: "Thread Team",
    fromAddress: "hello@thread.dev",
    snippet: "Explore queue-first email, AI priority, and MCP tools without connecting Gmail first.",
    unread: true,
    hoursAgo: 2,
  },
  {
    threadId: "demo-thread-hackathon",
    subject: "Corsair integration checklist",
    fromName: "Judge Preview",
    fromAddress: "review@corsair.dev",
    snippet: "OAuth, Pub/Sub webhooks, Gmail History sync, and MCP headless access are wired up.",
    unread: true,
    hoursAgo: 5,
  },
  {
    threadId: "demo-thread-queue",
    subject: "Re: Approve before send?",
    fromName: "Product Safety",
    fromAddress: "safety@thread.dev",
    snippet: "Human-in-the-loop is the default — queue_email waits for your approval in /queue.",
    unread: false,
    hoursAgo: 26,
  },
  {
    threadId: "demo-thread-calendar",
    subject: "Schedule: demo sync tomorrow",
    fromName: "Calendar Bot",
    fromAddress: "calendar@thread.dev",
    snippet: "Connect Google Calendar to see live events — sample queue items are already seeded.",
    unread: false,
    hoursAgo: 48,
  },
] as const;

async function seedDemoMailCache(db: NodePgDatabase, userId: string) {
  for (const fixture of DEMO_MAIL_FIXTURES) {
    const lastMessageAt = new Date(Date.now() - fixture.hoursAgo * 3_600_000);
    await db
      .insert(threadMailCacheTable)
      .values({
        id: `${userId}:${fixture.threadId}`,
        userId,
        threadId: fixture.threadId,
        subject: fixture.subject,
        fromName: fixture.fromName,
        fromAddress: fixture.fromAddress,
        snippet: fixture.snippet,
        lastMessageAt,
        messageCount: 1,
        unread: fixture.unread,
        labelIds: ["INBOX"],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [threadMailCacheTable.userId, threadMailCacheTable.threadId],
        set: {
          subject: fixture.subject,
          fromName: fixture.fromName,
          fromAddress: fixture.fromAddress,
          snippet: fixture.snippet,
          lastMessageAt,
          unread: fixture.unread,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`[seed] Demo mail cache seeded (${DEMO_MAIL_FIXTURES.length} threads).`);
}

async function ensureWelcomePendingItem(db: NodePgDatabase, userId: string) {
  const rows = await db
    .select({ id: threadQueueItemsTable.id, title: threadQueueItemsTable.title, status: threadQueueItemsTable.status })
    .from(threadQueueItemsTable)
    .where(eq(threadQueueItemsTable.userId, userId));

  const welcomeItem = rows.find((row) => row.title === "Send: Welcome to Thread demo");
  if (welcomeItem?.status === "pending") {
    return;
  }

  if (welcomeItem) {
    await db
      .update(threadQueueItemsTable)
      .set({ status: "pending", resolvedAt: null, errorMessage: null })
      .where(eq(threadQueueItemsTable.id, welcomeItem.id));
    console.log("[seed] Reset demo welcome queue item to pending.");
    return;
  }

  await db.insert(threadQueueItemsTable).values({
    userId,
    kind: "email_send",
    title: "Send: Welcome to Thread demo",
    preview: "This is a sample queued email for the analytics dashboard.",
    payload: {
      to: "guest@example.com",
      subject: "Welcome to Thread demo",
      body: "Hi — this sample queue item shows how approval works before Gmail sends.",
    },
    status: "pending",
  });
  console.log("[seed] Demo welcome queue item inserted.");
}

async function ensureDemoQueueItems(db: NodePgDatabase, userId: string) {
  const rows = await db
    .select({ id: threadQueueItemsTable.id })
    .from(threadQueueItemsTable)
    .where(eq(threadQueueItemsTable.userId, userId))
    .limit(1);

  if (rows.length > 0) {
    return;
  }

  const tomorrow = new Date(Date.now() + 86_400_000);
  const dayAfter = new Date(tomorrow.getTime() + 3_600_000);
  await db.insert(threadQueueItemsTable).values([
    {
      userId,
      kind: "email_send",
      title: "Send: Welcome to Thread demo",
      preview: "This is a sample queued email for the analytics dashboard.",
      payload: {
        to: "guest@example.com",
        subject: "Welcome to Thread demo",
        body: "Hi — this sample queue item shows how approval works before Gmail sends.",
      },
      status: "pending",
    },
    {
      userId,
      kind: "calendar_invite",
      title: "Invite: Demo sync",
      preview: `${tomorrow.toISOString()} → ${dayAfter.toISOString()}`,
      payload: {
        summary: "Demo sync",
        description: "Sample calendar invite queued for approval.",
        startDateTime: tomorrow.toISOString(),
        endDateTime: dayAfter.toISOString(),
        timeZone: "UTC",
      },
      status: "approved",
      resolvedAt: new Date(),
    },
    {
      userId,
      kind: "email_draft",
      title: "Draft: Follow-up note",
      preview: "Thanks for trying Thread — approve to save this draft in Gmail.",
      payload: {
        to: "you@example.com",
        subject: "Follow-up note",
        body: "Thanks for trying Thread. This draft was seeded for demo analytics.",
      },
      status: "dismissed",
      resolvedAt: new Date(),
    },
  ]);
  console.log("[seed] Sample queue items inserted for demo analytics.");
}

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
      const userId = existing[0]!.id;
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      await db
        .update(usersTable)
        .set({ passwordHash, emailVerified: true })
        .where(eq(usersTable.id, userId));
      console.log(`[seed] Demo user already exists: ${email} (password synced from SEED_DEMO_PASSWORD)`);
      await seedDemoMailCache(db, userId);
      await ensureWelcomePendingItem(db, userId);
      await ensureDemoQueueItems(db, userId);
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

    if (user?.id) {
      const tomorrow = new Date(Date.now() + 86_400_000);
      const dayAfter = new Date(tomorrow.getTime() + 3_600_000);
      await db.insert(threadQueueItemsTable).values([
        {
          userId: user.id,
          kind: "email_send",
          title: "Send: Welcome to Thread demo",
          preview: "This is a sample queued email for the analytics dashboard.",
          payload: {
            to: "guest@example.com",
            subject: "Welcome to Thread demo",
            body: "Hi — this sample queue item shows how approval works before Gmail sends.",
          },
          status: "pending",
        },
        {
          userId: user.id,
          kind: "calendar_invite",
          title: "Invite: Demo sync",
          preview: `${tomorrow.toISOString()} → ${dayAfter.toISOString()}`,
          payload: {
            summary: "Demo sync",
            description: "Sample calendar invite queued for approval.",
            startDateTime: tomorrow.toISOString(),
            endDateTime: dayAfter.toISOString(),
            timeZone: "UTC",
          },
          status: "approved",
          resolvedAt: new Date(),
        },
        {
          userId: user.id,
          kind: "email_draft",
          title: "Draft: Follow-up note",
          preview: "Thanks for trying Thread — approve to save this draft in Gmail.",
          payload: {
            to: "you@example.com",
            subject: "Follow-up note",
            body: "Thanks for trying Thread. This draft was seeded for demo analytics.",
          },
          status: "dismissed",
          resolvedAt: new Date(),
        },
      ]);
      console.log("[seed] Sample queue items inserted for demo analytics.");
      await seedDemoMailCache(db, user.id);
    }

    console.log(`[seed] Done.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
