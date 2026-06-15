import type { CalendarEvent } from "../calendar";
import type { InboxThread } from "../inbox";
import {
  daysSince,
  extractEmailAddress,
  findFocusWindows,
  formatLocalTimeRange,
  normalizeEmail,
  zonedDayRange,
  zonedWallTimeToIso,
  type FocusWindow,
} from "./daily-brief-time";
import { getCalendarService } from "../calendar";
import { getInboxService } from "../inbox";
import { getQueueService } from "../queue";
import { rankInboxThreads } from "./inbox-priority";
import { isOpenAiConfigured } from "./openai";

export type BriefThreadSnapshot = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date?: string;
  unread?: boolean;
  awaitingReply?: boolean;
  daysWaiting?: number | null;
  lastMessageFrom?: string;
};

export type BriefMeetingSnapshot = {
  id: string;
  summary: string;
  start?: string;
  end?: string;
  needsPrep: boolean;
  relatedEmailCount: number;
  attendeeNames: string[];
};

export type BriefGatherResult = {
  userName: string;
  userEmail?: string;
  timeZone: string;
  gmailConnected: boolean;
  calendarConnected: boolean;
  threads: BriefThreadSnapshot[];
  rankedThreadIds: string[];
  meetings: BriefMeetingSnapshot[];
  focusWindows: FocusWindow[];
  focusWindowLabel?: string;
  pendingQueue: Array<{ id: string; title: string; kind: string }>;
  deadlineThreadIds: string[];
  invoiceThreadIds: string[];
};

const DETAIL_THREAD_LIMIT = 6;
const MEETING_PREP_SEARCH_LIMIT = 3;

function displayNameFromEmail(email?: string, displayName?: string | null): string {
  if (displayName?.trim()) return displayName.trim();
  if (!email) return "there";
  const local = email.split("@")[0] ?? "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function threadSnapshot(thread: InboxThread, extra?: Partial<BriefThreadSnapshot>): BriefThreadSnapshot {
  return {
    id: thread.id,
    subject: thread.subject?.trim() || "No subject",
    from: thread.fromName?.trim() || thread.from?.trim() || "Unknown sender",
    snippet: thread.snippet?.trim() || "",
    date: thread.date,
    unread: thread.unread,
    ...extra,
  };
}

function meetingNeedsPrep(event: CalendarEvent): boolean {
  const description = event.description?.trim() ?? "";
  if (description.length < 24) return true;
  return !/(agenda|prep|discuss|goal|objective|talking point)/i.test(description);
}

function isAwaitingUserReply(
  thread: InboxThread,
  userEmail?: string,
): { awaiting: boolean; daysWaiting: number | null; lastMessageFrom?: string } {
  const messages = thread.messages ?? [];
  if (messages.length === 0) {
    return { awaiting: Boolean(thread.unread), daysWaiting: daysSince(thread.date), lastMessageFrom: thread.from };
  }

  const last = messages[messages.length - 1]!;
  const lastFrom = extractEmailAddress(last.from) ?? last.from ?? "";
  const user = normalizeEmail(userEmail);

  if (user && lastFrom && lastFrom.includes(user)) {
    return { awaiting: false, daysWaiting: null, lastMessageFrom: last.from };
  }

  return {
    awaiting: true,
    daysWaiting: daysSince(last.date ?? thread.date),
    lastMessageFrom: last.from,
  };
}

function dedupeThreads(threads: InboxThread[]): InboxThread[] {
  const map = new Map<string, InboxThread>();
  for (const thread of threads) {
    if (!map.has(thread.id)) map.set(thread.id, thread);
  }
  return [...map.values()];
}

function buildMeetingSearchQuery(event: CalendarEvent): string | null {
  const summary = event.summary?.trim();
  const attendee = event.attendees?.find((a) => a.email && !a.organizer)?.email?.trim();
  if (summary && summary.length > 2) {
    return `newer_than:30d subject:"${summary.replace(/"/g, "")}"`;
  }
  if (attendee) {
    return `newer_than:30d from:${attendee}`;
  }
  return null;
}

export async function gatherDailyBriefContext(input: {
  tenantId: string;
  userEmail?: string;
  displayName?: string | null;
  timeZone?: string;
}): Promise<BriefGatherResult> {
  const timeZone = input.timeZone?.trim() || "UTC";
  const userName = displayNameFromEmail(input.userEmail, input.displayName);
  const inbox = getInboxService();
  const calendar = getCalendarService();
  const queue = getQueueService();

  const [gmailStatus, calendarStatus, pendingItems] = await Promise.all([
    inbox.getConnectionStatus(input.tenantId),
    calendar.getConnectionStatus(input.tenantId),
    queue.listItems(input.tenantId, { status: "pending" }).catch(() => []),
  ]);

  const gmailConnected = gmailStatus.gmail === "connected";
  const calendarConnected = calendarStatus.googlecalendar === "connected";

  const day = zonedDayRange(timeZone);

  const inboxListPromise = gmailConnected
    ? inbox.listThreads(input.tenantId, { maxResults: 20, query: "in:inbox" })
    : Promise.resolve({ threads: [] as InboxThread[] });

  const unreadPromise = gmailConnected
    ? inbox.listThreads(input.tenantId, { maxResults: 15, query: "in:inbox is:unread" })
    : Promise.resolve({ threads: [] as InboxThread[] });

  const deadlinePromise = gmailConnected
    ? inbox.listThreads(input.tenantId, {
        maxResults: 10,
        query: 'newer_than:14d (deadline OR "due date" OR "by EOD" OR urgent OR "action required")',
      })
    : Promise.resolve({ threads: [] as InboxThread[] });

  const invoicePromise = gmailConnected
    ? inbox.listThreads(input.tenantId, {
        maxResults: 10,
        query: 'newer_than:30d (invoice OR unpaid OR "payment due")',
      })
    : Promise.resolve({ threads: [] as InboxThread[] });

  const eventsPromise = calendarConnected
    ? calendar.listEvents(input.tenantId, {
        timeMin: day.timeMin,
        timeMax: day.timeMax,
        maxResults: 25,
        timeZone,
      })
    : Promise.resolve({ events: [] as CalendarEvent[] });

  const freeBusyPromise = calendarConnected
    ? calendar.checkFreeBusy(input.tenantId, {
        startDateTime: day.timeMin,
        endDateTime: day.timeMax,
        timeZone,
      })
    : Promise.resolve({ conflicts: [] as CalendarEvent[] });

  const [
    inboxList,
    unreadList,
    deadlineList,
    invoiceList,
    eventsResult,
    freeBusyResult,
  ] = await Promise.all([
    inboxListPromise,
    unreadPromise,
    deadlinePromise,
    invoicePromise,
    eventsPromise,
    freeBusyPromise,
  ]);

  const merged = dedupeThreads([
    ...unreadList.threads,
    ...deadlineList.threads,
    ...invoiceList.threads,
    ...inboxList.threads,
  ]);

  let rankedThreadIds = merged.map((t) => t.id);
  if (gmailConnected && merged.length > 1 && isOpenAiConfigured()) {
    try {
      rankedThreadIds = await rankInboxThreads(
        merged.slice(0, 20).map((t) => ({
          id: t.id,
          snippet: t.snippet,
          subject: t.subject,
          from: t.fromName ?? t.from,
        })),
      );
    } catch {
      rankedThreadIds = merged.map((t) => t.id);
    }
  }

  const detailIds = rankedThreadIds.slice(0, DETAIL_THREAD_LIMIT);
  const detailThreads = await Promise.all(
    detailIds.map(async (id) => {
      try {
        return await inbox.getThread(input.tenantId, id, { userEmail: input.userEmail });
      } catch {
        return null;
      }
    }),
  );

  const threadSnapshots: BriefThreadSnapshot[] = [];
  for (const thread of detailThreads) {
    if (!thread) continue;
    const reply = isAwaitingUserReply(thread, input.userEmail);
    threadSnapshots.push(
      threadSnapshot(thread, {
        awaitingReply: reply.awaiting,
        daysWaiting: reply.daysWaiting,
        lastMessageFrom: reply.lastMessageFrom,
      }),
    );
  }

  const todayEvents = (eventsResult.events ?? []).filter((e) => e.status !== "cancelled");
  const prepCandidates = todayEvents.filter(meetingNeedsPrep).slice(0, MEETING_PREP_SEARCH_LIMIT);

  const relatedCounts = await Promise.all(
    prepCandidates.map(async (event) => {
      const query = buildMeetingSearchQuery(event);
      if (!query || !gmailConnected) return 0;
      try {
        const found = await inbox.listThreads(input.tenantId, { maxResults: 5, query });
        return found.threads.length;
      } catch {
        return 0;
      }
    }),
  );

  const meetings: BriefMeetingSnapshot[] = todayEvents.map((event) => {
    const prepIndex = prepCandidates.findIndex((c) => c.id === event.id);
    return {
      id: event.id,
      summary: event.summary?.trim() || "Untitled meeting",
      start: event.start,
      end: event.end,
      needsPrep: meetingNeedsPrep(event),
      relatedEmailCount: prepIndex >= 0 ? relatedCounts[prepIndex] ?? 0 : 0,
      attendeeNames: (event.attendees ?? [])
        .map((a) => a.displayName?.trim() || a.email?.split("@")[0] || "")
        .filter(Boolean)
        .slice(0, 4),
    };
  });

  const busySlots = (freeBusyResult.conflicts ?? []).map((slot) => ({
    start: slot.start ?? day.timeMin,
    end: slot.end ?? day.timeMax,
  }));

  const focusWindows = findFocusWindows({
    dayStartIso: zonedWallTimeToIso(day.dateKey, "09:00:00", timeZone),
    dayEndIso: zonedWallTimeToIso(day.dateKey, "18:00:00", timeZone),
    busySlots,
    minMinutes: 90,
  });

  const focusWindowLabel =
    focusWindows[0] != null
      ? formatLocalTimeRange(focusWindows[0].startIso, focusWindows[0].endIso, timeZone)
      : undefined;

  return {
    userName,
    userEmail: input.userEmail,
    timeZone,
    gmailConnected,
    calendarConnected,
    threads: threadSnapshots,
    rankedThreadIds,
    meetings,
    focusWindows,
    focusWindowLabel,
    pendingQueue: pendingItems.slice(0, 8).map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
    })),
    deadlineThreadIds: deadlineList.threads.map((t) => t.id),
    invoiceThreadIds: invoiceList.threads.map((t) => t.id),
  };
}

export function serializeGatherForModel(context: BriefGatherResult): string {
  const lines: string[] = [
    `User: ${context.userName}`,
    `Timezone: ${context.timeZone}`,
    `Gmail connected: ${context.gmailConnected}`,
    `Calendar connected: ${context.calendarConnected}`,
  ];

  if (context.focusWindowLabel) {
    lines.push(`Best focus window today: ${context.focusWindowLabel}`);
  }

  if (context.pendingQueue.length > 0) {
    lines.push("", "Pending approval queue:");
    for (const item of context.pendingQueue) {
      lines.push(`- [${item.kind}] ${item.title} (queueId=${item.id})`);
    }
  }

  if (context.threads.length > 0) {
    lines.push("", "Email threads (most important first):");
    for (const thread of context.threads) {
      const waiting =
        thread.awaitingReply && thread.daysWaiting != null
          ? ` | awaiting reply ${thread.daysWaiting}d`
          : thread.awaitingReply
            ? " | awaiting reply"
            : "";
      lines.push(
        `- id=${thread.id} | from=${thread.from} | subject=${thread.subject}${waiting}`,
      );
      if (thread.snippet) lines.push(`  snippet: ${thread.snippet.slice(0, 180)}`);
    }
  }

  if (context.meetings.length > 0) {
    lines.push("", "Today's calendar events:");
    for (const meeting of context.meetings) {
      const prep = meeting.needsPrep ? " | needs prep" : "";
      const related =
        meeting.relatedEmailCount > 0 ? ` | ${meeting.relatedEmailCount} related emails` : "";
      lines.push(
        `- id=${meeting.id} | ${meeting.summary} | start=${meeting.start ?? "?"}${prep}${related}`,
      );
      if (meeting.attendeeNames.length > 0) {
        lines.push(`  attendees: ${meeting.attendeeNames.join(", ")}`);
      }
    }
  }

  if (!context.gmailConnected && !context.calendarConnected) {
    lines.push("", "No integrations connected — suggest connecting Gmail and Calendar.");
  }

  return lines.join("\n");
}
