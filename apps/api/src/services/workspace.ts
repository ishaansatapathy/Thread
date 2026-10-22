import { and, eq, lt } from "@repo/database";
import db from "@repo/database";
import { agentUploadsTable } from "@repo/database/schema";
import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import { ServiceError, serviceError } from "@repo/services/errors";
import {
  WORKSPACE_PLUGINS,
  driveFileUrl,
  type DriveFileText,
  type ClassroomAnnouncement,
  type ClassroomCourse,
  type ClassroomCourseWork,
  type ClassroomDueWork,
  type ClassroomSubmission,
  type DocumentRef,
  type DriveFile,
  type DriveRole,
  type FormQuestion,
  type FormRef,
  type FormResponse,
  type MeetConference,
  type MeetSpace,
  type MeetTranscript,
  type PresentationRef,
  type SlideOutlineSlide,
  type SpreadsheetRef,
  type StagedUploadMeta,
  type WorkspaceConnectionState,
  type WorkspaceConnectionStatus,
  type WorkspacePlugin,
  type WorkspaceService,
} from "@repo/services/workspace";

import { getCorsair, getCorsairCalendarRedirectUri, isCorsairConfigured } from "../corsair";
import { getCorsairOAuthModule } from "../corsair-imports";
import { markdownToDocsRequests } from "../utils/markdown-to-docs";
import { outlineToSlidesRequests } from "../utils/outline-to-slides";
import {
  escapeDriveQuery,
  quoteSheetName,
  safeDriveFilename,
  sanitizeSheetRows,
} from "../utils/workspace-format";
import { disconnectCorsairConnection } from "./corsair-disconnect";
import { ensureCorsairTenant } from "./corsair-tenant";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const STATUS_CACHE_TTL_MS = 60_000;
/** Right after OAuth completes, a transient verify failure shouldn't hide "connected" for a full minute. */
const UNVERIFIED_STATUS_CACHE_TTL_MS = 5_000;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_AGENT_UPLOAD_BYTES = 4 * 1024 * 1024;

const statusCache = new Map<string, { status: WorkspaceConnectionStatus; expiresAt: number }>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function invalidateWorkspaceConnectionCache(tenantId: string) {
  statusCache.delete(tenantId);
}

type KeyManager = {
  get_access_token: () => Promise<string | null>;
  set_access_token: (value: string) => Promise<void>;
  get_refresh_token: () => Promise<string | null>;
  get_expires_at: () => Promise<string | null>;
  set_expires_at: (value: string) => Promise<void>;
  get_integration_credentials: () => Promise<{ client_id: string | null; client_secret: string | null }>;
};

type LooseEndpoint = (args: Record<string, unknown>) => Promise<unknown>;
type LoosePlugin = {
  api: Record<string, Record<string, LooseEndpoint>>;
  keys: KeyManager;
};

/**
 * The pinned Workspace plugin versions type their endpoints against a newer Corsair
 * core, so calls go through this narrow loose view instead of the generated types.
 */
function plugin(tenantId: string, name: WorkspacePlugin): LoosePlugin {
  const tenant = getCorsair().withTenant(tenantId) as unknown as Record<string, LoosePlugin>;
  const scoped = tenant[name];
  if (!scoped) throw serviceError("INTERNAL", `Corsair plugin ${name} is not registered`);
  return scoped;
}

async function call<T>(tenantId: string, name: WorkspacePlugin, group: string, endpoint: string, args: Record<string, unknown>) {
  const fn = plugin(tenantId, name).api[group]?.[endpoint];
  if (!fn) throw serviceError("INTERNAL", `Corsair endpoint ${name}.${group}.${endpoint} is missing`);
  return (await fn(args)) as T;
}

const tokenRefreshes = new Map<string, Promise<string>>();

async function refreshAccessToken(tenantId: string, name: WorkspacePlugin): Promise<string> {
  const keys = plugin(tenantId, name).keys;
  const [refreshToken, creds] = await Promise.all([keys.get_refresh_token(), keys.get_integration_credentials()]);
  if (!refreshToken || !creds.client_id || !creds.client_secret) {
    throw serviceError("PRECONDITION_FAILED", "Google authorization expired. Reconnect this app from the Workspace menu.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    logger.warn("workspace.token_refresh_failed", { tenantId, plugin: name, status: res.status });
    throw serviceError("PRECONDITION_FAILED", "Google authorization expired. Reconnect this app from the Workspace menu.");
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Math.floor(Date.now() / 1000) + body.expires_in;
  await keys.set_access_token(body.access_token);
  await keys.set_expires_at(String(expiresAt));
  return body.access_token;
}

async function getAccessToken(tenantId: string, name: WorkspacePlugin, force = false): Promise<string> {
  const keys = plugin(tenantId, name).keys;
  if (!force) {
    const [token, expiresAt] = await Promise.all([keys.get_access_token(), keys.get_expires_at()]);
    const now = Math.floor(Date.now() / 1000);
    if (token && expiresAt && Number(expiresAt) > now + 120) return token;
  }
  const key = `${tenantId}:${name}`;
  const inflight = tokenRefreshes.get(key);
  if (inflight) return inflight;
  const next = refreshAccessToken(tenantId, name).finally(() => tokenRefreshes.delete(key));
  tokenRefreshes.set(key, next);
  return next;
}

class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Direct Google REST call authorised with the Corsair-managed OAuth token. Used where
 * the pinned Corsair plugins cannot do the job (binary uploads, multi-row writes).
 */
async function authorizedFetch(
  tenantId: string,
  name: WorkspacePlugin,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let token = await getAccessToken(tenantId, name);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && attempt === 0) {
      token = await getAccessToken(tenantId, name, true);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `Google API error ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // non-JSON error body
      }
      throw new GoogleApiError(message, res.status);
    }
    return res;
  }
  throw new GoogleApiError("Google authorization failed", 401);
}

async function googleFetch<T>(
  tenantId: string,
  name: WorkspacePlugin,
  url: string,
  init: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
  const res = await authorizedFetch(tenantId, name, url, init);
  const contentType = res.headers.get("content-type") ?? "";
  const data = (contentType.includes("application/json") ? await res.json() : await res.text()) as T;
  return { data, headers: res.headers };
}

function userFacingGoogleError(error: unknown, action: string): never {
  if (error instanceof ServiceError) throw error;
  const status =
    error instanceof GoogleApiError
      ? error.status
      : ((error as { status?: number }).status ?? (error as { response?: { status?: number } }).response?.status);
  const message = error instanceof Error ? error.message : String(error);
  logger.warn("workspace.google_call_failed", { action, status, message });
  if (status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(message)) {
    throw serviceError(
      "PRECONDITION_FAILED",
      `${action} failed: this Google API is not enabled for the Thread Google Cloud project.`,
    );
  }
  if (status === 403 || status === 401) {
    throw serviceError("PRECONDITION_FAILED", `${action} failed: Google denied access. Reconnect the app and try again.`);
  }
  if (status === 404) {
    throw serviceError("NOT_FOUND", `${action} failed: the file or folder no longer exists or is not shared with you.`);
  }
  throw serviceError("INTERNAL", `${action} failed: ${message}`);
}

type RawDriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
};

function mapDriveFile(file: RawDriveFile): DriveFile | null {
  if (!file.id) return null;
  return {
    id: file.id,
    name: file.name ?? "Untitled",
    mimeType: file.mimeType,
    isFolder: file.mimeType === FOLDER_MIME,
    webViewLink: file.webViewLink,
    modifiedTime: file.modifiedTime,
    size: file.size ? Number(file.size) : undefined,
    parents: file.parents,
  };
}

const DRIVE_FIELDS = "id,name,mimeType,webViewLink,modifiedTime,size,parents";

/** Drive's export endpoint caps at 10 MB; these formats keep Google files readable as plain text. */
const GOOGLE_TEXT_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const MAX_READ_BYTES = 15 * 1024 * 1024;

function isTextMime(mime: string) {
  return (
    mime.startsWith("text/") ||
    ["application/json", "application/xml", "application/x-yaml", "application/csv", "application/rtf"].includes(mime)
  );
}

type DocsElement = {
  paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: DocsElement[] }> }> };
  tableOfContents?: { content?: DocsElement[] };
};

export function extractDocsText(content: DocsElement[]): string {
  let out = "";
  for (const el of content) {
    if (el.paragraph) {
      out += (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) {
        out += `${(row.tableCells ?? []).map((cell) => extractDocsText(cell.content ?? []).trim()).join("\t")}\n`;
      }
    } else if (el.tableOfContents) {
      out += extractDocsText(el.tableOfContents.content ?? []);
    }
  }
  return out;
}

// ── Forms ───────────────────────────────────────────────────────────────────

type FormItem = { title?: string; questionItem?: { question?: { questionId?: string } } };
type FormApiResponse = {
  responseId?: string;
  lastSubmittedTime?: string;
  answers?: Record<string, { textAnswers?: { answers?: Array<{ value?: string }> } }>;
};

const CHOICE_TYPE: Record<string, string> = { multiple_choice: "RADIO", checkboxes: "CHECKBOX", dropdown: "DROP_DOWN" };

/** Forms API `Question` body. Grading is only attached for quizzes (the API rejects it otherwise). */
export function formQuestionBody(question: FormQuestion, isQuiz = false): Record<string, unknown> {
  const body: Record<string, unknown> = { required: question.required ?? false };
  const choiceType = CHOICE_TYPE[question.type];
  if (choiceType) {
    body.choiceQuestion = { type: choiceType, options: (question.options ?? []).map((value) => ({ value })) };
  } else {
    body.textQuestion = { paragraph: question.type === "paragraph" };
  }
  // Paragraph answers can't be auto-graded; Forms only accepts an answer key for choice and short-answer.
  if (isQuiz && question.type !== "paragraph" && (question.points !== undefined || question.correctAnswers?.length)) {
    body.grading = {
      pointValue: question.points ?? 1,
      ...(question.correctAnswers?.length
        ? { correctAnswers: { answers: question.correctAnswers.map((value) => ({ value })) } }
        : {}),
    };
  }
  return body;
}

function createItemRequests(questions: FormQuestion[], startIndex: number, isQuiz: boolean) {
  return questions.map((question, i) => ({
    createItem: {
      item: { title: question.title.slice(0, 500), questionItem: { question: formQuestionBody(question, isQuiz) } },
      location: { index: startIndex + i },
    },
  }));
}

// ── Slides ──────────────────────────────────────────────────────────────────

type SlidesApiSlide = {
  pageElements?: Array<{ shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } }>;
};

// ── Classroom ───────────────────────────────────────────────────────────────

type ClassroomApiCourse = { id?: string; name?: string; section?: string; courseState?: string };
type ClassroomApiCourseWork = {
  id?: string;
  title?: string;
  description?: string;
  dueDate?: { year?: number; month?: number; day?: number };
  dueTime?: { hours?: number; minutes?: number };
  workType?: string;
  state?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Classroom stores due dates as UTC date + time parts. */
function classroomDueMs(date?: { year?: number; month?: number; day?: number }, time?: { hours?: number; minutes?: number }) {
  if (!date?.year || !date.month || !date.day) return undefined;
  return Date.UTC(date.year, date.month - 1, date.day, time?.hours ?? 23, time?.minutes ?? 59);
}

/** ISO date-time (with offset) → Classroom UTC parts. A bare date means 23:59 UTC that day. */
export function toClassroomDue(iso: string) {
  const bare = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (bare) {
    return {
      dueDate: { year: Number(bare[1]), month: Number(bare[2]), day: Number(bare[3]) },
      dueTime: { hours: 23, minutes: 59 },
    };
  }
  const d = new Date(iso);
  return {
    dueDate: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    dueTime: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() },
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Follows Classroom's nextPageToken, capped so a huge roster can't stall a request. */
async function fetchAllPages<T>(tenantId: string, url: string, key: string, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const { data } = await googleFetch<Record<string, unknown> & { nextPageToken?: string }>(
      tenantId,
      "googleclassroom",
      pageToken ? `${url}${sep}pageToken=${encodeURIComponent(pageToken)}` : url,
    );
    out.push(...((data[key] as T[] | undefined) ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

function formatClassroomDate(date?: { year?: number; month?: number; day?: number }, time?: { hours?: number; minutes?: number }) {
  if (!date?.year || !date.month || !date.day) return undefined;
  const iso = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  if (time?.hours === undefined) return iso;
  return `${iso}T${String(time.hours).padStart(2, "0")}:${String(time.minutes ?? 0).padStart(2, "0")}:00Z`;
}

async function probePlugin(tenantId: string, name: WorkspacePlugin): Promise<void> {
  switch (name) {
    case "googledrive":
      await call(tenantId, name, "files", "list", { pageSize: 1, q: "trashed=false" });
      return;
    case "googlesheets":
      await googleFetch(tenantId, name, "https://sheets.googleapis.com/v4/spreadsheets/thread-connection-check");
      return;
    case "googlemeet":
      await call(tenantId, name, "conferenceRecords", "list", { pageSize: 1 });
      return;
    case "googleforms":
      await googleFetch(tenantId, name, "https://forms.googleapis.com/v1/forms/thread-connection-check");
      return;
    case "googleslides":
      await googleFetch(tenantId, name, "https://slides.googleapis.com/v1/presentations/thread-connection-check");
      return;
    case "googleclassroom":
      await googleFetch(tenantId, name, "https://classroom.googleapis.com/v1/courses?pageSize=1");
      return;
  }
}

/**
 * Right after OAuth completes, the freshly-stored token can briefly fail a live probe
 * (token-store write still propagating) — one retry avoids flashing "not connected".
 */
async function verifyPlugin(tenantId: string, name: WorkspacePlugin): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await probePlugin(tenantId, name);
      return true;
    } catch (error) {
      // A 404/400 for the probe id proves the token works. A disabled Cloud API is a
      // server setup problem, not a missing user connection — actions report it clearly.
      const status = error instanceof GoogleApiError ? error.status : undefined;
      if (status === 404 || status === 400) return true;
      if (status === 403 && error instanceof Error && /has not been used|is disabled|accessNotConfigured/i.test(error.message)) {
        return true;
      }
      if (attempt === 0) {
        await sleep(600);
        continue;
      }
      logger.warn("workspace.connection_verify_failed", {
        tenantId,
        plugin: name,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  return false;
}

export class CorsairWorkspaceService implements WorkspaceService {
  isConfigured() {
    if (!isCorsairConfigured()) return false;
    const google = getGoogleOAuthConfig();
    return Boolean(google.clientId && google.clientSecret);
  }

  async getConnectionStatus(tenantId: string): Promise<WorkspaceConnectionStatus> {
    const empty = (state: WorkspaceConnectionState) =>
      Object.fromEntries(WORKSPACE_PLUGINS.map((p) => [p, state])) as WorkspaceConnectionStatus;
    if (!this.isConfigured()) return empty("not_configured");

    const cached = statusCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.status;

    try {
      await ensureCorsairTenant(tenantId);
      const raw = (await getCorsair().manage.connectionStatus.get({ tenantId })) as Record<string, string | undefined>;
      let unverified = false;
      const entries = await Promise.all(
        WORKSPACE_PLUGINS.map(async (name): Promise<[WorkspacePlugin, WorkspaceConnectionState]> => {
          const state = (raw[name] ?? "not_connected") as WorkspaceConnectionState;
          if (state !== "connected") return [name, state];
          const verified = await verifyPlugin(tenantId, name);
          if (!verified) unverified = true;
          return [name, verified ? "connected" : "not_connected"];
        }),
      );
      const status = Object.fromEntries(entries) as WorkspaceConnectionStatus;
      // Corsair says connected but the live probe failed (e.g. a token just written by
      // OAuth is still propagating) — recheck soon instead of hiding "connected" for a minute.
      const ttl = unverified ? UNVERIFIED_STATUS_CACHE_TTL_MS : STATUS_CACHE_TTL_MS;
      statusCache.set(tenantId, { status, expiresAt: Date.now() + ttl });
      return status;
    } catch (error) {
      logger.warn("workspace.connection_status_failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      return empty("not_connected");
    }
  }

  async disconnect(tenantId: string, name: WorkspacePlugin): Promise<void> {
    await disconnectCorsairConnection(tenantId, name);
    invalidateWorkspaceConnectionCache(tenantId);
  }

  async getConnectUrl(tenantId: string, name: WorkspacePlugin) {
    if (!this.isConfigured()) throw new Error("Google Workspace integration is not configured on the server");
    await ensureCorsairTenant(tenantId);
    const { generateOAuthUrl } = getCorsairOAuthModule();
    const { url } = await generateOAuthUrl(getCorsair(), name, {
      tenantId,
      redirectUri: getCorsairCalendarRedirectUri(),
    });
    return url;
  }

  // ── Drive ────────────────────────────────────────────────────────────────

  async driveListFiles(
    tenantId: string,
    opts: { query?: string; folderId?: string; foldersOnly?: boolean; mimeType?: string; maxResults?: number },
  ): Promise<DriveFile[]> {
    const clauses = ["trashed=false"];
    if (opts.query) clauses.push(`name contains '${escapeDriveQuery(opts.query)}'`);
    if (opts.folderId) clauses.push(`'${escapeDriveQuery(opts.folderId)}' in parents`);
    if (opts.foldersOnly) clauses.push(`mimeType='${FOLDER_MIME}'`);
    else if (opts.mimeType) clauses.push(`mimeType='${escapeDriveQuery(opts.mimeType)}'`);
    const params = new URLSearchParams({
      q: clauses.join(" and "),
      pageSize: String(Math.min(Math.max(opts.maxResults ?? 20, 1), 50)),
      orderBy: "modifiedTime desc",
      fields: `files(${DRIVE_FIELDS})`,
    });
    try {
      const { data } = await googleFetch<{ files?: RawDriveFile[] }>(
        tenantId,
        "googledrive",
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      );
      return (data.files ?? []).map(mapDriveFile).filter((f): f is DriveFile => f !== null);
    } catch (error) {
      userFacingGoogleError(error, "Drive search");
    }
  }

  async driveFindFolderByName(tenantId: string, name: string, parentId?: string): Promise<DriveFile | null> {
    const clauses = [
      "trashed=false",
      `mimeType='${FOLDER_MIME}'`,
      `name='${escapeDriveQuery(name)}'`,
      "'me' in owners",
    ];
    if (parentId) clauses.push(`'${escapeDriveQuery(parentId)}' in parents`);
    const params = new URLSearchParams({
      q: clauses.join(" and "),
      pageSize: "5",
      orderBy: "modifiedTime desc",
      fields: `files(${DRIVE_FIELDS})`,
    });
    try {
      const { data } = await googleFetch<{ files?: RawDriveFile[] }>(
        tenantId,
        "googledrive",
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      );
      const first = (data.files ?? []).map(mapDriveFile).find((f): f is DriveFile => f !== null);
      return first ?? null;
    } catch (error) {
      userFacingGoogleError(error, "Drive folder lookup");
    }
  }

  async driveCreateFolder(tenantId: string, input: { name: string; parentId?: string }): Promise<DriveFile> {
    try {
      const created = await call<RawDriveFile>(tenantId, "googledrive", "folders", "create", {
        name: safeDriveFilename(input.name, "New folder"),
        ...(input.parentId ? { parents: [input.parentId] } : {}),
      });
      const mapped = mapDriveFile({ ...created, mimeType: FOLDER_MIME });
      if (!mapped) throw serviceError("INTERNAL", "Drive did not return the new folder id");
      return mapped;
    } catch (error) {
      userFacingGoogleError(error, "Creating the Drive folder");
    }
  }

  async driveUploadFile(
    tenantId: string,
    input: { name: string; mimeType: string; data: Uint8Array; parentId?: string },
  ): Promise<DriveFile> {
    const metadata = {
      name: safeDriveFilename(input.name),
      mimeType: input.mimeType,
      ...(input.parentId ? { parents: [input.parentId] } : {}),
    };
    try {
      // Resumable upload works for any size and keeps metadata + bytes as separate calls.
      const session = await googleFetch<unknown>(
        tenantId,
        "googledrive",
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${DRIVE_FIELDS}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": input.mimeType,
            "X-Upload-Content-Length": String(input.data.byteLength),
          },
          body: JSON.stringify(metadata),
        },
      );
      const location = session.headers.get("location");
      if (!location) throw serviceError("INTERNAL", "Drive did not open an upload session");
      const { data } = await googleFetch<RawDriveFile>(tenantId, "googledrive", location, {
        method: "PUT",
        headers: { "Content-Type": input.mimeType },
        body: Buffer.from(input.data),
      });
      const mapped = mapDriveFile(data);
      if (!mapped) throw serviceError("INTERNAL", "Drive did not return the uploaded file id");
      return mapped;
    } catch (error) {
      userFacingGoogleError(error, `Uploading ${input.name} to Drive`);
    }
  }

  async driveMoveFile(tenantId: string, input: { fileId: string; folderId: string }): Promise<DriveFile> {
    try {
      const current = await call<RawDriveFile>(tenantId, "googledrive", "files", "get", { fileId: input.fileId });
      const { data } = await googleFetch<RawDriveFile>(
        tenantId,
        "googledrive",
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?${new URLSearchParams({
          addParents: input.folderId,
          removeParents: (current.parents ?? []).filter((p) => p !== input.folderId).join(","),
          fields: DRIVE_FIELDS,
        }).toString()}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const mapped = mapDriveFile(data);
      if (!mapped) throw serviceError("INTERNAL", "Drive did not return the moved file");
      return mapped;
    } catch (error) {
      userFacingGoogleError(error, "Moving the Drive file");
    }
  }

  async driveShareFile(
    tenantId: string,
    input: { fileId: string; email: string; role: DriveRole; notify: boolean; message?: string },
  ): Promise<void> {
    try {
      const params = new URLSearchParams({ sendNotificationEmail: String(input.notify) });
      if (input.notify && input.message) params.set("emailMessage", input.message);
      await googleFetch(
        tenantId,
        "googledrive",
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions?${params.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "user", role: input.role, emailAddress: input.email }),
        },
      );
    } catch (error) {
      userFacingGoogleError(error, "Sharing the Drive file");
    }
  }

  // ── Sheets ───────────────────────────────────────────────────────────────

  async sheetsCreate(
    tenantId: string,
    input: { title: string; rows?: string[][]; folderId?: string },
  ): Promise<SpreadsheetRef> {
    type Created = {
      spreadsheetId?: string;
      spreadsheetUrl?: string;
      sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    };
    let created: Created;
    try {
      created = await call<Created>(tenantId, "googlesheets", "spreadsheets", "create", {
        properties: { title: input.title },
      });
    } catch (error) {
      userFacingGoogleError(error, "Creating the Google Sheet");
    }
    const spreadsheetId = created.spreadsheetId;
    if (!spreadsheetId) throw serviceError("INTERNAL", "Sheets did not return the new spreadsheet id");
    const url = created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    const firstSheet = created.sheets?.[0]?.properties;

    if (input.rows && input.rows.length > 0) {
      const range = `${quoteSheetName(firstSheet?.title ?? "Sheet1")}!A1`;
      try {
        await googleFetch(
          tenantId,
          "googlesheets",
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ range, majorDimension: "ROWS", values: sanitizeSheetRows(input.rows) }),
          },
        );
      } catch (error) {
        userFacingGoogleError(error, "Writing rows to the new sheet");
      }

      if (firstSheet?.sheetId !== undefined && input.rows.length > 1) {
        const columnCount = Math.max(...input.rows.map((r) => r.length), 1);
        try {
          await googleFetch(tenantId, "googlesheets", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: [
                {
                  repeatCell: {
                    range: { sheetId: firstSheet.sheetId, startRowIndex: 0, endRowIndex: 1 },
                    cell: { userEnteredFormat: { textFormat: { bold: true } } },
                    fields: "userEnteredFormat.textFormat.bold",
                  },
                },
                {
                  updateSheetProperties: {
                    properties: { sheetId: firstSheet.sheetId, gridProperties: { frozenRowCount: 1 } },
                    fields: "gridProperties.frozenRowCount",
                  },
                },
                {
                  autoResizeDimensions: {
                    dimensions: { sheetId: firstSheet.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columnCount },
                  },
                },
              ],
            }),
          });
        } catch (error) {
          logger.warn("workspace.sheet_format_failed", {
            tenantId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (input.folderId) {
      await this.driveMoveFile(tenantId, { fileId: spreadsheetId, folderId: input.folderId });
    }
    return { spreadsheetId, title: input.title, url };
  }

  private async firstSheetTitle(tenantId: string, spreadsheetId: string): Promise<string> {
    const { data } = await googleFetch<{ sheets?: Array<{ properties?: { title?: string } }> }>(
      tenantId,
      "googlesheets",
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    );
    return data.sheets?.[0]?.properties?.title ?? "Sheet1";
  }

  async sheetsAppendRows(
    tenantId: string,
    input: { spreadsheetId: string; sheetName?: string; rows: string[][] },
  ): Promise<{ updatedRows: number; url: string }> {
    try {
      const sheet = input.sheetName ?? (await this.firstSheetTitle(tenantId, input.spreadsheetId));
      const range = `${quoteSheetName(sheet)}!A1`;
      const { data } = await googleFetch<{ updates?: { updatedRows?: number } }>(
        tenantId,
        "googlesheets",
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ majorDimension: "ROWS", values: sanitizeSheetRows(input.rows) }),
        },
      );
      return {
        updatedRows: data.updates?.updatedRows ?? input.rows.length,
        url: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}/edit`,
      };
    } catch (error) {
      userFacingGoogleError(error, "Adding rows to the sheet");
    }
  }

  async sheetsReadRows(
    tenantId: string,
    input: { spreadsheetId: string; sheetName?: string; range?: string; maxRows?: number },
  ): Promise<{ rows: string[][]; truncated: boolean }> {
    try {
      const sheet = input.sheetName ?? (await this.firstSheetTitle(tenantId, input.spreadsheetId));
      const range = input.range?.includes("!") ? input.range : `${quoteSheetName(sheet)}${input.range ? `!${input.range}` : ""}`;
      const { data } = await googleFetch<{ values?: unknown[][] }>(
        tenantId,
        "googlesheets",
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}`,
      );
      const all = (data.values ?? []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
      const max = input.maxRows ?? 200;
      return { rows: all.slice(0, max), truncated: all.length > max };
    } catch (error) {
      userFacingGoogleError(error, "Reading the sheet");
    }
  }

  // ── Docs ─────────────────────────────────────────────────────────────────

  // Docs runs on the Drive grant: the `drive` scope authorises the Docs API.
  async docsCreate(
    tenantId: string,
    input: { title: string; markdown: string; folderId?: string },
  ): Promise<DocumentRef> {
    let documentId: string | undefined;
    try {
      const { data } = await googleFetch<{ documentId?: string }>(tenantId, "googledrive", "https://docs.googleapis.com/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: input.title }),
      });
      documentId = data.documentId;
    } catch (error) {
      userFacingGoogleError(error, "Creating the Google Doc");
    }
    if (!documentId) throw serviceError("INTERNAL", "Docs did not return the new document id");

    const { requests } = markdownToDocsRequests(input.markdown);
    if (requests.length > 0) {
      try {
        await googleFetch(tenantId, "googledrive", `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requests }),
        });
      } catch (error) {
        userFacingGoogleError(error, "Writing the Google Doc content");
      }
    }

    if (input.folderId) {
      await this.driveMoveFile(tenantId, { fileId: documentId, folderId: input.folderId });
    }
    return { documentId, title: input.title, url: `https://docs.google.com/document/d/${documentId}/edit` };
  }

  async docsReadText(
    tenantId: string,
    input: { documentId: string; maxChars?: number },
  ): Promise<{ title?: string; text: string; truncated: boolean }> {
    try {
      const { data } = await googleFetch<{ title?: string; body?: { content?: DocsElement[] } }>(
        tenantId,
        "googledrive",
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(input.documentId)}`,
      );
      const text = extractDocsText(data.body?.content ?? []).replace(/\n{3,}/g, "\n\n").trim();
      const max = input.maxChars ?? 20_000;
      return { title: data.title, text: text.slice(0, max), truncated: text.length > max };
    } catch (error) {
      userFacingGoogleError(error, "Reading the Google Doc");
    }
  }

  async driveReadFileText(tenantId: string, input: { fileId: string; maxChars?: number }): Promise<DriveFileText> {
    const max = input.maxChars ?? 20_000;
    const id = encodeURIComponent(input.fileId);
    try {
      const { data: raw } = await googleFetch<RawDriveFile>(
        tenantId,
        "googledrive",
        `https://www.googleapis.com/drive/v3/files/${id}?fields=${DRIVE_FIELDS}&supportsAllDrives=true`,
      );
      const file = mapDriveFile(raw);
      if (!file) throw serviceError("NOT_FOUND", "Drive did not return that file");
      const base = {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        url: driveFileUrl(file),
        modifiedTime: file.modifiedTime,
      };
      const done = (text: string): DriveFileText => {
        const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        return { ...base, text: clean.slice(0, max), truncated: clean.length > max };
      };
      const unreadable = (reason: string): DriveFileText => ({ ...base, text: "", truncated: false, unreadable: reason });

      const mime = file.mimeType ?? "";
      const exportAs = GOOGLE_TEXT_EXPORTS[mime];
      if (exportAs) {
        const res = await authorizedFetch(
          tenantId,
          "googledrive",
          `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(exportAs)}`,
        );
        return done(await res.text());
      }
      if (file.isFolder) return unreadable("This is a folder. Use search_drive with its folderId to list what's inside.");
      if (mime.startsWith("application/vnd.google-apps.")) return unreadable("This Google file type has no text export.");
      if (file.size && file.size > MAX_READ_BYTES) {
        return unreadable(`The file is ${Math.round(file.size / 1024 / 1024)} MB — too large to read here.`);
      }

      const isPdf = mime === "application/pdf";
      if (!isPdf && !isTextMime(mime)) {
        return unreadable(`Files of type ${mime || "unknown"} can't be read as text. Open it from the link instead.`);
      }
      const res = await authorizedFetch(
        tenantId,
        "googledrive",
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,
      );
      if (!isPdf) return done(await res.text());

      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      const pdfText = Array.isArray(text) ? text.join("\n\n") : text;
      if (!pdfText.trim()) return unreadable("This PDF has no text layer (it's probably a scan).");
      return done(pdfText);
    } catch (error) {
      userFacingGoogleError(error, "Reading the Drive file");
    }
  }

  // ── Meet ─────────────────────────────────────────────────────────────────

  async meetCreateSpace(tenantId: string): Promise<MeetSpace> {
    try {
      const space = await call<{ name?: string; meetingUri?: string; meetingCode?: string }>(
        tenantId,
        "googlemeet",
        "spaces",
        "create",
        {},
      );
      if (!space.meetingUri) throw serviceError("INTERNAL", "Meet did not return a meeting link");
      return { meetingUri: space.meetingUri, meetingCode: space.meetingCode, name: space.name };
    } catch (error) {
      userFacingGoogleError(error, "Creating the Meet link");
    }
  }

  async meetListConferences(tenantId: string, opts: { maxResults?: number }): Promise<MeetConference[]> {
    try {
      const res = await call<{
        conferenceRecords?: Array<{ name?: string; space?: string; startTime?: string; endTime?: string }>;
      }>(tenantId, "googlemeet", "conferenceRecords", "list", { pageSize: Math.min(opts.maxResults ?? 10, 20) });
      return (res.conferenceRecords ?? [])
        .filter((r): r is { name: string; space?: string; startTime?: string; endTime?: string } => Boolean(r.name))
        .map((r) => ({ name: r.name, spaceName: r.space, startTime: r.startTime, endTime: r.endTime }));
    } catch (error) {
      userFacingGoogleError(error, "Listing Meet conferences");
    }
  }

  async meetGetTranscript(
    tenantId: string,
    input: { conferenceRecord: string; maxChars?: number },
  ): Promise<MeetTranscript | null> {
    const record = input.conferenceRecord.startsWith("conferenceRecords/")
      ? input.conferenceRecord
      : `conferenceRecords/${input.conferenceRecord}`;
    const maxChars = input.maxChars ?? 30_000;
    try {
      const transcripts = await call<{ transcripts?: Array<{ name?: string; state?: string }> }>(
        tenantId,
        "googlemeet",
        "transcripts",
        "list",
        { parent: record },
      );
      const transcript = (transcripts.transcripts ?? []).find((t) => t.name && t.state !== "STARTED") ??
        (transcripts.transcripts ?? []).find((t) => t.name);
      if (!transcript?.name) return null;

      const speakers = new Map<string, string>();
      try {
        const participants = await call<{
          participants?: Array<{
            name?: string;
            signedinUser?: { displayName?: string };
            anonymousUser?: { displayName?: string };
            phoneUser?: { displayName?: string };
          }>;
        }>(tenantId, "googlemeet", "participants", "list", { parent: record, pageSize: 100 });
        for (const p of participants.participants ?? []) {
          const display = p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName;
          if (p.name && display) speakers.set(p.name, display);
        }
      } catch {
        // Speaker names are a nicety; the transcript is still useful without them.
      }

      const entries: MeetTranscript["entries"] = [];
      let text = "";
      let truncated = false;
      let pageToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await call<{
          transcriptEntries?: Array<{ participant?: string; text?: string; startTime?: string }>;
          nextPageToken?: string;
        }>(tenantId, "googlemeet", "transcriptEntries", "list", {
          parent: transcript.name,
          pageSize: 100,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const entry of res.transcriptEntries ?? []) {
          if (!entry.text) continue;
          const speaker = entry.participant ? (speakers.get(entry.participant) ?? "Speaker") : "Speaker";
          const line = `${speaker}: ${entry.text}\n`;
          if (text.length + line.length > maxChars) {
            truncated = true;
            break;
          }
          entries.push({ speaker, text: entry.text, startTime: entry.startTime });
          text += line;
        }
        pageToken = res.nextPageToken;
        if (truncated || !pageToken) break;
      }
      return { conferenceRecord: record, entries, text: text.trim(), truncated };
    } catch (error) {
      userFacingGoogleError(error, "Reading the Meet transcript");
    }
  }

  // ── Forms ────────────────────────────────────────────────────────────────

  async formsCreate(
    tenantId: string,
    input: { title: string; description?: string; questions: FormQuestion[]; isQuiz?: boolean; folderId?: string },
  ): Promise<FormRef> {
    let formId: string | undefined;
    try {
      const { data } = await googleFetch<{ formId?: string }>(tenantId, "googleforms", "https://forms.googleapis.com/v1/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ info: { title: input.title } }),
      });
      formId = data.formId;
    } catch (error) {
      userFacingGoogleError(error, "Creating the Google Form");
    }
    if (!formId) throw serviceError("INTERNAL", "Forms did not return the new form id");

    // forms.create only takes a title. Quiz mode must be on before graded items are added.
    const requests: Record<string, unknown>[] = [];
    if (input.isQuiz) {
      requests.push({ updateSettings: { settings: { quizSettings: { isQuiz: true } }, updateMask: "quizSettings.isQuiz" } });
    }
    if (input.description) {
      requests.push({ updateFormInfo: { info: { description: input.description }, updateMask: "description" } });
    }
    requests.push(...createItemRequests(input.questions, 0, input.isQuiz ?? false));
    await this.formsBatchUpdate(tenantId, formId, requests);

    if (input.folderId) {
      try {
        await this.driveMoveFile(tenantId, { fileId: formId, folderId: input.folderId });
      } catch {
        // Form was created; failing to file it away isn't worth failing the whole action over.
      }
    }
    return this.formsPublish(tenantId, formId);
  }

  async formsAddQuestions(tenantId: string, input: { formId: string; questions: FormQuestion[] }): Promise<FormRef> {
    let form: { items?: unknown[]; settings?: { quizSettings?: { isQuiz?: boolean } } };
    try {
      ({ data: form } = await googleFetch<typeof form>(
        tenantId,
        "googleforms",
        `https://forms.googleapis.com/v1/forms/${encodeURIComponent(input.formId)}`,
      ));
    } catch (error) {
      userFacingGoogleError(error, "Opening the Google Form");
    }
    const requests = createItemRequests(input.questions, form.items?.length ?? 0, form.settings?.quizSettings?.isQuiz ?? false);
    await this.formsBatchUpdate(tenantId, input.formId, requests);
    // Never touch publish state here: the owner may have closed responses on purpose.
    return this.formsRef(tenantId, input.formId);
  }

  private async formsBatchUpdate(tenantId: string, formId: string, requests: Record<string, unknown>[]) {
    if (requests.length === 0) return;
    try {
      await googleFetch(tenantId, "googleforms", `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}:batchUpdate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });
    } catch (error) {
      userFacingGoogleError(error, "Writing the Google Form questions");
    }
  }

  /**
   * Forms created through the API after 2026-06-30 start unpublished and can't take
   * responses until published. Publishing also yields the real responder link,
   * which is a separate id from formId and can't be derived from it.
   */
  private async formsPublish(tenantId: string, formId: string): Promise<FormRef> {
    try {
      await googleFetch(
        tenantId,
        "googleforms",
        `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}:setPublishSettings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } },
            updateMask: "publishState",
          }),
        },
      );
    } catch (error) {
      logger.warn("workspace.forms_publish_failed", {
        tenantId,
        formId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return this.formsRef(tenantId, formId);
  }

  /** Reads back the responder link and whether the form is actually live. */
  private async formsRef(tenantId: string, formId: string): Promise<FormRef> {
    const url = `https://docs.google.com/forms/d/${formId}/edit`;
    try {
      const { data } = await googleFetch<{
        responderUri?: string;
        publishSettings?: { publishState?: { isPublished?: boolean; isAcceptingResponses?: boolean } };
      }>(tenantId, "googleforms", `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}?fields=responderUri,publishSettings`);
      const state = data.publishSettings?.publishState;
      // Legacy forms have no publishSettings and are always live.
      const published = state ? Boolean(state.isPublished && state.isAcceptingResponses) : true;
      return { formId, url, responderUrl: data.responderUri, published };
    } catch {
      return { formId, url, published: false };
    }
  }

  async formsGetResponses(
    tenantId: string,
    input: { formId: string; maxResponses?: number },
  ): Promise<{ responses: FormResponse[]; truncated: boolean }> {
    const max = Math.min(input.maxResponses ?? 50, 200);
    try {
      const [{ data: form }, { data: responseList }] = await Promise.all([
        googleFetch<{ items?: FormItem[] }>(tenantId, "googleforms", `https://forms.googleapis.com/v1/forms/${encodeURIComponent(input.formId)}`),
        googleFetch<{ responses?: FormApiResponse[]; nextPageToken?: string }>(
          tenantId,
          "googleforms",
          `https://forms.googleapis.com/v1/forms/${encodeURIComponent(input.formId)}/responses?pageSize=${max}`,
        ),
      ]);
      const titleByQuestionId = new Map<string, string>();
      for (const item of form.items ?? []) {
        const questionId = item.questionItem?.question?.questionId;
        if (questionId) titleByQuestionId.set(questionId, item.title ?? "Untitled question");
      }
      const all = responseList.responses ?? [];
      const responses: FormResponse[] = all.slice(0, max).map((r) => ({
        responseId: r.responseId ?? "",
        submittedAt: r.lastSubmittedTime,
        answers: Object.entries(r.answers ?? {}).map(([questionId, answer]) => ({
          question: titleByQuestionId.get(questionId) ?? "Question",
          answer: (answer.textAnswers?.answers ?? []).map((a) => a.value ?? "").join(", "),
        })),
      }));
      return { responses, truncated: all.length > max || Boolean(responseList.nextPageToken) };
    } catch (error) {
      userFacingGoogleError(error, "Reading form responses");
    }
  }

  // ── Slides ───────────────────────────────────────────────────────────────

  async slidesCreate(
    tenantId: string,
    input: { title: string; outline: SlideOutlineSlide[]; folderId?: string },
  ): Promise<PresentationRef> {
    let presentationId: string | undefined;
    let defaultSlideId: string | undefined;
    try {
      const { data } = await googleFetch<{ presentationId?: string; slides?: Array<{ objectId?: string }> }>(
        tenantId,
        "googleslides",
        "https://slides.googleapis.com/v1/presentations",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: input.title }) },
      );
      presentationId = data.presentationId;
      defaultSlideId = data.slides?.[0]?.objectId;
    } catch (error) {
      userFacingGoogleError(error, "Creating the Google Slides presentation");
    }
    if (!presentationId || !defaultSlideId) {
      throw serviceError("INTERNAL", "Slides did not return the new presentation id");
    }

    const requests = outlineToSlidesRequests(input.outline, defaultSlideId);
    try {
      await googleFetch(tenantId, "googleslides", `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });
    } catch (error) {
      userFacingGoogleError(error, "Writing the Slides content");
    }

    if (input.folderId) {
      try {
        await this.driveMoveFile(tenantId, { fileId: presentationId, folderId: input.folderId });
      } catch {
        // Presentation exists; folder placement is a nicety.
      }
    }
    return { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` };
  }

  async slidesReadText(tenantId: string, input: { presentationId: string }): Promise<{ title?: string; text: string }> {
    try {
      const { data } = await googleFetch<{ title?: string; slides?: SlidesApiSlide[] }>(
        tenantId,
        "googleslides",
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(input.presentationId)}`,
      );
      const text = (data.slides ?? [])
        .map((slide, i) => {
          const lines = (slide.pageElements ?? [])
            .flatMap((el) => el.shape?.text?.textElements ?? [])
            .map((t) => t.textRun?.content ?? "")
            .join("");
          return `Slide ${i + 1}:\n${lines.trim()}`;
        })
        .join("\n\n");
      return { title: data.title, text };
    } catch (error) {
      userFacingGoogleError(error, "Reading the presentation");
    }
  }

  // ── Classroom ────────────────────────────────────────────────────────────

  async classroomListCourses(tenantId: string, opts: { maxResults?: number }): Promise<ClassroomCourse[]> {
    try {
      const params = new URLSearchParams({
        courseStates: "ACTIVE",
        pageSize: String(Math.min(opts.maxResults ?? 20, 50)),
      });
      const { data } = await googleFetch<{ courses?: ClassroomApiCourse[] }>(
        tenantId,
        "googleclassroom",
        `https://classroom.googleapis.com/v1/courses?${params.toString()}`,
      );
      return (data.courses ?? [])
        .filter((c): c is ClassroomApiCourse & { id: string; name: string } => Boolean(c.id && c.name))
        .map((c) => ({ id: c.id, name: c.name, section: c.section, courseState: c.courseState }));
    } catch (error) {
      userFacingGoogleError(error, "Listing Classroom courses");
    }
  }

  async classroomListCourseWork(tenantId: string, input: { courseId: string }): Promise<ClassroomCourseWork[]> {
    try {
      const { data } = await googleFetch<{ courseWork?: ClassroomApiCourseWork[] }>(
        tenantId,
        "googleclassroom",
        `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(input.courseId)}/courseWork?pageSize=50&orderBy=dueDate desc`,
      );
      return (data.courseWork ?? [])
        .filter((w): w is ClassroomApiCourseWork & { id: string; title: string } => Boolean(w.id && w.title))
        .map((w) => ({
          id: w.id,
          title: w.title,
          description: w.description,
          dueDate: formatClassroomDate(w.dueDate, w.dueTime),
          workType: w.workType,
          state: w.state,
        }));
    } catch (error) {
      userFacingGoogleError(error, "Listing Classroom coursework");
    }
  }

  async classroomListAnnouncements(tenantId: string, input: { courseId: string }): Promise<ClassroomAnnouncement[]> {
    try {
      const { data } = await googleFetch<{ announcements?: Array<{ id?: string; text?: string; creationTime?: string }> }>(
        tenantId,
        "googleclassroom",
        `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(input.courseId)}/announcements?pageSize=20&orderBy=updateTime desc`,
      );
      return (data.announcements ?? [])
        .filter((a): a is { id: string; text: string; creationTime?: string } => Boolean(a.id && a.text))
        .map((a) => ({ id: a.id, text: a.text, creationTime: a.creationTime }));
    } catch (error) {
      userFacingGoogleError(error, "Listing Classroom announcements");
    }
  }

  async classroomPostAnnouncement(tenantId: string, input: { courseId: string; text: string }): Promise<{ id: string }> {
    try {
      const { data } = await googleFetch<{ id?: string }>(
        tenantId,
        "googleclassroom",
        `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(input.courseId)}/announcements`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input.text }) },
      );
      if (!data.id) throw serviceError("INTERNAL", "Classroom did not return the new announcement id");
      return { id: data.id };
    } catch (error) {
      userFacingGoogleError(error, "Posting the Classroom announcement");
    }
  }

  /**
   * Upcoming (and up to a week overdue) coursework across every active course in
   * one call, so "what's due this week?" doesn't burn an agent round per course.
   * For courses where the user is a student, their own submission state is attached.
   */
  async classroomListDueWork(tenantId: string, input: { withinDays: number }): Promise<ClassroomDueWork[]> {
    const courses = await this.classroomListCourses(tenantId, { maxResults: 30 });
    const now = Date.now();
    const from = now - 7 * DAY_MS;
    const to = now + input.withinDays * DAY_MS;

    const perCourse = await mapLimit(courses, 5, async (course) => {
      const base = `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(course.id)}`;
      let work: ClassroomApiCourseWork[] = [];
      try {
        ({ data: { courseWork: work = [] } } = await googleFetch<{ courseWork?: ClassroomApiCourseWork[] }>(
          tenantId,
          "googleclassroom",
          `${base}/courseWork?courseWorkStates=PUBLISHED&pageSize=50&orderBy=dueDate desc`,
        ));
      } catch (error) {
        logger.warn("workspace.classroom_coursework_failed", { tenantId, courseId: course.id, message: String(error) });
        return [];
      }
      const due = work.filter((w) => {
        const at = classroomDueMs(w.dueDate, w.dueTime);
        return w.id && w.title && at !== undefined && at >= from && at <= to;
      });
      if (due.length === 0) return [];

      const mine = new Map<string, { state?: string; late?: boolean }>();
      try {
        const { data } = await googleFetch<{
          studentSubmissions?: Array<{ courseWorkId?: string; state?: string; late?: boolean }>;
        }>(tenantId, "googleclassroom", `${base}/courseWork/-/studentSubmissions?userId=me&pageSize=100`);
        for (const s of data.studentSubmissions ?? []) {
          if (s.courseWorkId) mine.set(s.courseWorkId, { state: s.state, late: s.late });
        }
      } catch {
        // Teachers have no submissions of their own; that's expected, not an error.
      }

      return due.map((w) => ({
        id: w.id!,
        title: w.title!,
        description: w.description,
        dueDate: formatClassroomDate(w.dueDate, w.dueTime),
        workType: w.workType,
        state: w.state,
        courseId: course.id,
        courseName: course.name,
        mySubmissionState: mine.get(w.id!)?.state,
        late: mine.get(w.id!)?.late,
      }));
    });

    return perCourse.flat().sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  }

  /** Who turned in, who hasn't, and who was late — joined with the roster for names. */
  async classroomListSubmissions(
    tenantId: string,
    input: { courseId: string; courseWorkId: string },
  ): Promise<ClassroomSubmission[]> {
    const base = `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(input.courseId)}`;
    try {
      const [submissions, students] = await Promise.all([
        fetchAllPages<{ userId?: string; state?: string; late?: boolean; assignedGrade?: number }>(
          tenantId,
          `${base}/courseWork/${encodeURIComponent(input.courseWorkId)}/studentSubmissions?pageSize=100`,
          "studentSubmissions",
        ),
        fetchAllPages<{ userId?: string; profile?: { name?: { fullName?: string }; emailAddress?: string } }>(
          tenantId,
          `${base}/students?pageSize=100`,
          "students",
        ),
      ]);
      const roster = new Map(students.map((s) => [s.userId, s.profile]));
      return submissions.map((s) => {
        const profile = roster.get(s.userId);
        return {
          studentName: profile?.name?.fullName ?? "Unknown student",
          studentEmail: profile?.emailAddress,
          state: s.state ?? "NEW",
          late: s.late ?? false,
          assignedGrade: s.assignedGrade,
        };
      });
    } catch (error) {
      userFacingGoogleError(error, "Reading Classroom submissions");
    }
  }

  async classroomCreateCourseWork(
    tenantId: string,
    input: { courseId: string; title: string; description?: string; dueDate?: string; maxPoints?: number },
  ): Promise<{ id: string; url?: string }> {
    const body: Record<string, unknown> = {
      title: input.title,
      workType: "ASSIGNMENT",
      state: "PUBLISHED",
      ...(input.description ? { description: input.description } : {}),
      ...(input.maxPoints !== undefined ? { maxPoints: input.maxPoints } : {}),
      ...(input.dueDate ? toClassroomDue(input.dueDate) : {}),
    };
    try {
      const { data } = await googleFetch<{ id?: string; alternateLink?: string }>(
        tenantId,
        "googleclassroom",
        `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(input.courseId)}/courseWork`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!data.id) throw serviceError("INTERNAL", "Classroom did not return the new assignment id");
      return { id: data.id, url: data.alternateLink };
    } catch (error) {
      userFacingGoogleError(error, "Creating the Classroom assignment");
    }
  }

  // ── Staged chat uploads + Gmail attachments ──────────────────────────────

  async stageUpload(
    tenantId: string,
    input: { filename: string; mimeType: string; data: Buffer },
  ): Promise<StagedUploadMeta> {
    if (input.data.byteLength === 0) throw serviceError("BAD_REQUEST", "The file is empty");
    if (input.data.byteLength > MAX_AGENT_UPLOAD_BYTES) {
      throw serviceError("BAD_REQUEST", "Files up to 4 MB can be attached in chat");
    }
    await db
      .delete(agentUploadsTable)
      .where(lt(agentUploadsTable.createdAt, new Date(Date.now() - UPLOAD_TTL_MS)));
    const [row] = await db
      .insert(agentUploadsTable)
      .values({
        userId: tenantId,
        filename: safeDriveFilename(input.filename).slice(0, 255),
        mimeType: (input.mimeType || "application/octet-stream").slice(0, 200),
        size: input.data.byteLength,
        dataBase64: input.data.toString("base64"),
      })
      .returning({
        id: agentUploadsTable.id,
        filename: agentUploadsTable.filename,
        mimeType: agentUploadsTable.mimeType,
        size: agentUploadsTable.size,
      });
    if (!row) throw serviceError("INTERNAL", "Could not store the attached file");
    return row;
  }

  async getStagedUploadMeta(tenantId: string, uploadId: string): Promise<StagedUploadMeta | null> {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return null;
    const [row] = await db
      .select({
        id: agentUploadsTable.id,
        filename: agentUploadsTable.filename,
        mimeType: agentUploadsTable.mimeType,
        size: agentUploadsTable.size,
        createdAt: agentUploadsTable.createdAt,
      })
      .from(agentUploadsTable)
      .where(and(eq(agentUploadsTable.id, uploadId), eq(agentUploadsTable.userId, tenantId)))
      .limit(1);
    if (!row || row.createdAt.getTime() < Date.now() - UPLOAD_TTL_MS) return null;
    return { id: row.id, filename: row.filename, mimeType: row.mimeType, size: row.size };
  }

  async readStagedUpload(tenantId: string, uploadId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return null;
    const [row] = await db
      .select()
      .from(agentUploadsTable)
      .where(and(eq(agentUploadsTable.id, uploadId), eq(agentUploadsTable.userId, tenantId)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      data: new Uint8Array(Buffer.from(row.dataBase64, "base64")),
    };
  }

  async readGmailAttachment(tenantId: string, input: { messageId: string; attachmentId: string }) {
    const corsair = getCorsair().withTenant(tenantId);
    const attachment = await (
      corsair.gmail.api.users as unknown as {
        messages: {
          attachments: {
            get: (opts: { userId: string; messageId: string; id: string }) => Promise<{ data?: string }>;
          };
        };
      }
    ).messages.attachments.get({ userId: "me", messageId: input.messageId, id: input.attachmentId });
    if (!attachment.data) throw serviceError("NOT_FOUND", "That email attachment is no longer available");
    return new Uint8Array(Buffer.from(attachment.data.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  }
}
