import { and, eq, lt } from "@repo/database";
import db from "@repo/database";
import { agentUploadsTable } from "@repo/database/schema";
import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import { ServiceError, serviceError } from "@repo/services/errors";
import {
  WORKSPACE_PLUGINS,
  type DocumentRef,
  type DriveFile,
  type DriveRole,
  type MeetConference,
  type MeetSpace,
  type MeetTranscript,
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
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_AGENT_UPLOAD_BYTES = 4 * 1024 * 1024;

const statusCache = new Map<string, { status: WorkspaceConnectionStatus; expiresAt: number }>();

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
async function googleFetch<T>(
  tenantId: string,
  name: WorkspacePlugin,
  url: string,
  init: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
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
    const contentType = res.headers.get("content-type") ?? "";
    const data = (contentType.includes("application/json") ? await res.json() : await res.text()) as T;
    return { data, headers: res.headers };
  }
  throw new GoogleApiError("Google authorization failed", 401);
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

async function verifyPlugin(tenantId: string, name: WorkspacePlugin): Promise<boolean> {
  try {
    switch (name) {
      case "googledrive":
        await call(tenantId, name, "files", "list", { pageSize: 1, q: "trashed=false" });
        return true;
      case "googlesheets":
        await googleFetch(tenantId, name, "https://sheets.googleapis.com/v4/spreadsheets/thread-connection-check");
        return true;
      case "googlemeet":
        await call(tenantId, name, "conferenceRecords", "list", { pageSize: 1 });
        return true;
    }
  } catch (error) {
    // A 404/400 for the probe id proves the token works. A disabled Cloud API is a
    // server setup problem, not a missing user connection — actions report it clearly.
    const status = error instanceof GoogleApiError ? error.status : undefined;
    if (status === 404 || status === 400) return true;
    if (status === 403 && error instanceof Error && /has not been used|is disabled|accessNotConfigured/i.test(error.message)) {
      return true;
    }
    logger.warn("workspace.connection_verify_failed", {
      tenantId,
      plugin: name,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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
      const entries = await Promise.all(
        WORKSPACE_PLUGINS.map(async (name): Promise<[WorkspacePlugin, WorkspaceConnectionState]> => {
          const state = (raw[name] ?? "not_connected") as WorkspaceConnectionState;
          if (state !== "connected") return [name, state];
          return [name, (await verifyPlugin(tenantId, name)) ? "connected" : "not_connected"];
        }),
      );
      const status = Object.fromEntries(entries) as WorkspaceConnectionStatus;
      statusCache.set(tenantId, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
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
