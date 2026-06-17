/** Tracks brief items the user already acted on today (client-side until Gmail sync catches up). */

const STORAGE_KEY = "thread_brief_dismissed_v1";

type DismissedMap = Record<string, number>;

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function readMap(): DismissedMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DismissedMap;
    const dayStart = startOfTodayMs();
    const kept: DismissedMap = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && ts >= dayStart) kept[id] = ts;
    }
    return kept;
  } catch {
    return {};
  }
}

function writeMap(map: DismissedMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // private mode / quota
  }
}

export function getDismissedBriefThreadIds(): Set<string> {
  return new Set(Object.keys(readMap()));
}

/** Call when user opens inbox/agent/queue for a brief thread — hide until Gmail reflects the action. */
export function dismissBriefThread(threadId: string) {
  const id = threadId.trim();
  if (!id) return;
  const map = readMap();
  map[id] = Date.now();
  writeMap(map);
}

/** Drop dismissals for threads the server no longer flags (reply synced in Gmail). */
export function pruneBriefDismissals(stillActiveThreadIds: Set<string>) {
  const map = readMap();
  let changed = false;
  for (const id of Object.keys(map)) {
    if (!stillActiveThreadIds.has(id)) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) writeMap(map);
}

function threadIdFromHref(href?: string): string | undefined {
  if (!href) return undefined;
  const match = href.match(/[?&]thread=([^&]+)/);
  if (!match?.[1]) return undefined;
  return decodeURIComponent(match[1]);
}

/** After agent/queue acts on a thread, hide it from Needs attention until Gmail syncs. */
export function dismissBriefThreadsFromAgentActions(
  actions: Array<{ kind: string; href?: string; threadId?: string }>,
) {
  const ids = new Set<string>();
  for (const action of actions) {
    if (action.threadId) ids.add(action.threadId);
    const fromHref = threadIdFromHref(action.href);
    if (fromHref) ids.add(fromHref);
    if (action.kind === "email_queued" && action.threadId) ids.add(action.threadId);
  }
  for (const id of ids) dismissBriefThread(id);
}

export function dismissBriefThreadFromQueueItem(item: {
  sourceThreadId?: string;
  kind: string;
  payload: Record<string, unknown>;
}) {
  if (item.sourceThreadId) {
    dismissBriefThread(item.sourceThreadId);
    return;
  }
  if (item.kind === "email_send" || item.kind === "email_draft" || item.kind === "meeting_bundle") {
    const threadId = item.payload.threadId;
    if (typeof threadId === "string" && threadId.trim()) dismissBriefThread(threadId);
  }
}
