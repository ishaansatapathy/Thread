import { eq } from "@repo/database";
import db from "@repo/database";
import { threadCalendarStateTable } from "@repo/database/schema";
import { logger } from "@repo/logger";

export async function getCalendarChannel(userId: string) {
  const [row] = await db
    .select()
    .from(threadCalendarStateTable)
    .where(eq(threadCalendarStateTable.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function setCalendarChannel(
  userId: string,
  channel: { channelId: string; resourceId?: string; expiration?: Date },
) {
  await db
    .insert(threadCalendarStateTable)
    .values({
      userId,
      channelId: channel.channelId,
      resourceId: channel.resourceId,
      expiration: channel.expiration,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: threadCalendarStateTable.userId,
      set: {
        channelId: channel.channelId,
        resourceId: channel.resourceId,
        expiration: channel.expiration,
        updatedAt: new Date(),
      },
    });
}

export async function clearCalendarChannel(userId: string) {
  try {
    await db.delete(threadCalendarStateTable).where(eq(threadCalendarStateTable.userId, userId));
  } catch (error) {
    logger.warn("Failed to clear calendar channel state", {
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
