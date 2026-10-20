import { fenceEmailData } from "../ai/agent-guard";
import type { OpenAiToolDefinition } from "../ai/openai-tools";
import type { QueueEnqueueOrigin, QueueService } from "../queue";
import {
  WORKSPACE_PLUGIN_LABELS,
  driveFileUrl,
  type WorkspacePlugin,
  type WorkspaceService,
} from "./index";
import {
  describeWorkspaceAction,
  workspaceActionPayloadSchema,
  workspaceActionRequirements,
  type WorkspaceActionPayload,
  type WorkspaceFileSource,
} from "./schemas";

const folderTargetProps = {
  folderId: { type: "string", description: "Existing Google Drive folder id (from search_drive)." },
  folderName: {
    type: "string",
    description: "Folder name. Reused if a folder with this name exists in My Drive, otherwise created on approval.",
  },
};

const rowsProp = {
  type: "array",
  description: "Rows of cell values. First row should be the header row when creating a sheet.",
  items: { type: "array", items: { type: "string" } },
};

export const WORKSPACE_TOOLS: OpenAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_workspace_connection_status",
      description:
        "Check which Google Workspace apps (Drive, Sheets, Meet) the user has connected. Google Docs works whenever Drive is connected. Call before Workspace actions when unsure.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_drive",
      description:
        "Search the user's Google Drive by name. Use foldersOnly to find a folder id before saving or moving files. Omit query to list recent files.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text the file or folder name contains" },
          folderId: { type: "string", description: "Only list items inside this folder" },
          foldersOnly: { type: "boolean", description: "Return folders only" },
          maxResults: { type: "number", description: "1-50", default: 20 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_drive_save_files",
      description:
        "Queue saving files to Google Drive for approval. Sources: Gmail attachments (messageId + attachmentId from get_thread) and/or files the user attached in chat (uploadIds from the [Attached file …] note). Optionally into a folder (creates it on approval if needed).",
      parameters: {
        type: "object",
        properties: {
          gmailAttachments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                messageId: { type: "string" },
                attachmentId: { type: "string" },
                filename: { type: "string" },
                mimeType: { type: "string" },
              },
              required: ["messageId", "attachmentId", "filename"],
            },
          },
          uploadIds: { type: "array", items: { type: "string" }, description: "Chat upload ids" },
          ...folderTargetProps,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_drive_create_folder",
      description: "Queue creating a new Google Drive folder for approval.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          parentFolderId: { type: "string", description: "Optional parent folder id" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_drive_move_file",
      description: "Queue moving a Drive file into a folder for approval. Get fileId from search_drive.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string" },
          fileName: { type: "string" },
          ...folderTargetProps,
        },
        required: ["fileId", "fileName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_drive_share_file",
      description: "Queue sharing a Drive file or folder with someone for approval.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string" },
          fileName: { type: "string" },
          email: { type: "string" },
          role: { type: "string", enum: ["reader", "commenter", "writer"], default: "reader" },
          notify: { type: "boolean", description: "Email the person a share notification", default: true },
          message: { type: "string", description: "Optional note in the share email" },
        },
        required: ["fileId", "fileName", "email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_sheet_create",
      description:
        "Queue creating a Google Sheet for approval, optionally filled with rows (first row = headers). Use to turn data, notes, CSV text or a list into a spreadsheet.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          rows: rowsProp,
          ...folderTargetProps,
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_sheet_append_rows",
      description: "Queue appending rows to an existing Google Sheet for approval.",
      parameters: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          spreadsheetTitle: { type: "string" },
          sheetName: { type: "string", description: "Tab name, defaults to the first tab" },
          rows: rowsProp,
        },
        required: ["spreadsheetId", "rows"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_sheet",
      description: "Read rows from a Google Sheet (spreadsheetId from search_drive or a link).",
      parameters: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          sheetName: { type: "string" },
          range: { type: "string", description: "A1 range like A1:F50" },
        },
        required: ["spreadsheetId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_doc_create",
      description:
        "Queue creating a formatted Google Doc for approval from markdown (# headings, - bullets, 1. lists, **bold**). Use for proposals, notes, summaries, minutes.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          markdown: { type: "string" },
          ...folderTargetProps,
        },
        required: ["title", "markdown"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_doc",
      description: "Read the plain text of a Google Doc (documentId from search_drive or a link).",
      parameters: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_meet_link",
      description:
        "Create a new Google Meet link right away (nothing is sent to anyone). To invite people, put the link in queue_calendar_invite or queue_email.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_meet_conferences",
      description: "List the user's recent Google Meet conferences (newest first) to find one with a transcript.",
      parameters: {
        type: "object",
        properties: { maxResults: { type: "number", description: "1-20", default: 10 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_meet_transcript",
      description:
        "Get the transcript of a finished Google Meet conference (conferenceRecord like conferenceRecords/abc from list_meet_conferences). Use to extract notes and action items.",
      parameters: {
        type: "object",
        properties: { conferenceRecord: { type: "string" } },
        required: ["conferenceRecord"],
      },
    },
  },
];

export const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOLS.map((tool) => tool.function.name));

export type WorkspaceToolCard = {
  kind: "workspace_queued" | "workspace";
  title: string;
  detail?: string;
  href?: string;
  lines?: string[];
  disposition?: "sent" | "queued";
  queueItemId?: string;
};

export type WorkspaceToolContext = {
  tenantId: string;
  queue: QueueService;
  workspace: WorkspaceService;
  origin: QueueEnqueueOrigin;
};

export type WorkspaceToolOutcome = { result: unknown; card?: WorkspaceToolCard };

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function toRows(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

/** Model-supplied names can echo data fences or path separators — keep them plain. */
function cleanName(value: unknown, fallback: string) {
  const raw = str(value);
  if (!raw) return fallback;
  const cleaned = Array.from(raw.replace(/\[(?:EMAIL_DATA_START|EMAIL_DATA_END|DATA)\]/g, ""))
    .map((ch) => (ch === "/" || ch === "\\" || ch.charCodeAt(0) < 32 ? "_" : ch))
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned || fallback;
}

function folderTarget(args: Record<string, unknown>) {
  const folderName = str(args.folderName);
  return { folderId: str(args.folderId), folderName: folderName ? cleanName(folderName, "Thread") : undefined };
}

/** Accept bare ids or full Google URLs for sheets/docs. */
export function extractGoogleFileId(value: string): string {
  const match = value.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  return match?.[1] ?? value;
}

function notConnected(plugins: WorkspacePlugin[]) {
  const names = plugins.map((p) => WORKSPACE_PLUGIN_LABELS[p]).join(" and ");
  return {
    error: `${names} ${plugins.length > 1 ? "are" : "is"} not connected. Ask the user to connect it from the Workspace menu in the top bar, then try again.`,
    notConnected: plugins,
  };
}

async function missingPlugins(ctx: WorkspaceToolContext, required: WorkspacePlugin[]) {
  const status = await ctx.workspace.getConnectionStatus(ctx.tenantId);
  return required.filter((plugin) => status[plugin] !== "connected");
}

async function enqueue(
  ctx: WorkspaceToolContext,
  payload: WorkspaceActionPayload,
): Promise<WorkspaceToolOutcome> {
  const missing = await missingPlugins(ctx, workspaceActionRequirements(payload));
  if (missing.length > 0) return { result: notConnected(missing) };

  const { title, preview } = describeWorkspaceAction(payload);
  const item = await ctx.queue.enqueueWorkspaceAction(
    ctx.tenantId,
    { payload, title, preview },
    { origin: ctx.origin },
  );
  const done = item.status === "approved";
  return {
    result: {
      status: item.status,
      queueItemId: item.id,
      outcome: done ? "completed" : "queued_for_approval",
      message: done
        ? "Done."
        : "Queued — tell the user to approve it in the Queue (or the Actions panel) before it runs.",
    },
    card: {
      kind: "workspace_queued",
      title,
      detail: preview,
      href: "/queue",
      disposition: done ? "sent" : "queued",
      queueItemId: item.id,
    },
  };
}

function validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return {
    error: "Invalid arguments",
    issues: error.issues.slice(0, 5).map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`),
  };
}

/**
 * Runs a Workspace tool. Returns null when `name` is not a Workspace tool so callers
 * can fall through to their own handlers.
 */
export async function executeWorkspaceTool(
  name: string,
  args: Record<string, unknown>,
  ctx: WorkspaceToolContext,
): Promise<WorkspaceToolOutcome | null> {
  if (!WORKSPACE_TOOL_NAMES.has(name)) return null;
  const { tenantId, workspace } = ctx;

  switch (name) {
    case "get_workspace_connection_status": {
      const status = await workspace.getConnectionStatus(tenantId);
      return { result: { status } };
    }

    case "search_drive": {
      const missing = await missingPlugins(ctx, ["googledrive"]);
      if (missing.length > 0) return { result: notConnected(missing) };
      const query = str(args.query);
      const files = await workspace.driveListFiles(tenantId, {
        query,
        folderId: str(args.folderId),
        foldersOnly: args.foldersOnly === true,
        maxResults: clampNumber(args.maxResults, 20, 1, 50),
      });
      return {
        result: {
          count: files.length,
          files: files.map((f) => ({
            id: f.id,
            name: fenceEmailData(f.name),
            mimeType: f.mimeType,
            isFolder: f.isFolder,
            modifiedTime: f.modifiedTime,
            url: driveFileUrl(f),
          })),
        },
        card: {
          kind: "workspace",
          title: query ? `Drive: ${query}` : "Recent Drive files",
          detail: `${files.length} item(s)`,
          lines: files.slice(0, 8).map((f) => `${f.isFolder ? "Folder" : "File"} · ${f.name}`),
        },
      };
    }

    case "queue_drive_save_files": {
      const files: WorkspaceFileSource[] = [];
      const gmail = Array.isArray(args.gmailAttachments) ? args.gmailAttachments : [];
      for (const raw of gmail) {
        const a = (raw ?? {}) as Record<string, unknown>;
        files.push({
          type: "gmail_attachment",
          messageId: str(a.messageId) ?? "",
          attachmentId: str(a.attachmentId) ?? "",
          filename: cleanName(a.filename, "attachment"),
          mimeType: str(a.mimeType) ?? "application/octet-stream",
        });
      }
      const uploadIds = Array.isArray(args.uploadIds) ? args.uploadIds.map((v) => String(v)) : [];
      for (const uploadId of uploadIds) {
        const meta = await workspace.getStagedUploadMeta(tenantId, uploadId.trim());
        if (!meta) {
          return { result: { error: `Attached file ${uploadId} was not found or has expired. Ask the user to attach it again.` } };
        }
        files.push({ type: "upload", uploadId: meta.id, filename: meta.filename, mimeType: meta.mimeType });
      }
      const parsed = workspaceActionPayloadSchema.safeParse({
        action: "drive_save_files",
        files,
        ...folderTarget(args),
      });
      if (!parsed.success) return { result: validationError(parsed.error) };
      return enqueue(ctx, parsed.data);
    }

    case "queue_drive_create_folder": {
      const parsed = workspaceActionPayloadSchema.safeParse({
        action: "drive_create_folder",
        name: str(args.name) ? cleanName(args.name, "New folder") : undefined,
        parentFolderId: str(args.parentFolderId),
      });
      if (!parsed.success) return { result: validationError(parsed.error) };
      return enqueue(ctx, parsed.data);
    }

    case "queue_drive_move_file": {
      const target = folderTarget(args);
      if (!target.folderId && !target.folderName) {
        return { result: { error: "Pass folderId or folderName for the destination." } };
      }
      const parsed = workspaceActionPayloadSchema.safeParse({
        action: "drive_move_file",
        fileId: str(args.fileId),
        fileName: cleanName(args.fileName, "file"),
        ...target,
      });
      if (!parsed.success) return { result: validationError(parsed.error) };
      return enqueue(ctx, parsed.data);
    }

    case "queue_drive_share_file": {
      const parsed = workspaceActionPayloadSchema.safeParse({
        action: "drive_share_file",
        fileId: str(args.fileId),
        fileName: cleanName(args.fileName, "file"),
        email: str(args.email),
        role: str(args.role) ?? "reader",
        notify: args.notify !== false,
        message: str(args.message),
      });
      if (!parsed.success) return { result: validationError(parsed.error) };
      return enqueue(ctx, parsed.data);
    }

    case "queue_sheet_create": {
      const parsed = workspaceActionPayloadSchema.safeParse({
        action: "sheets_create",
        title: str(args.title) ? cleanName(args.title, "Untitled sheet") : undefined,
        rows: toRows(args.rows),
        ...folderTarget(args),
      });
      if (!parsed.success) return { result: validationError(parsed.error) };
      return enqueue(ctx, parsed.data);
    }

    case "queue_sheet_append_rows": {
      const spreadsheetId = str(args.spreadsheetId);
      const parsed = workspaceActionPayloadSchema.safeParse({
        action: "sheets_append_rows",
        spreadsheetId: spreadsheetId ? extractGoogleFileId(spreadsheetId) : undefined,
        spreadsheetTitle: str(args.spreadsheetTitle),
        sheetName: str(args.sheetName),
        rows: toRows(args.rows),
      });
      if (!parsed.success) return { result: validationError(parsed.error) };
      return enqueue(ctx, parsed.data);
    }

    case "read_sheet": {
      const missing = await missingPlugins(ctx, ["googlesheets"]);
      if (missing.length > 0) return { result: notConnected(missing) };
      const spreadsheetId = str(args.spreadsheetId);
      if (!spreadsheetId) return { result: { error: "spreadsheetId is required" } };
      const { rows, truncated } = await workspace.sheetsReadRows(tenantId, {
        spreadsheetId: extractGoogleFileId(spreadsheetId),
        sheetName: str(args.sheetName),
        range: str(args.range),
        maxRows: 200,
      });
      return {
        result: {
          rowCount: rows.length,
          truncated,
          rows: fenceEmailData(rows.map((row) => row.join("\t")).join("\n")),
        },
      };
    }

    case "queue_doc_create": {
      const parsed = workspaceActionPayloadSchema.safeParse({
        action: "docs_create",
        title: str(args.title) ? cleanName(args.title, "Untitled doc") : undefined,
        markdown: typeof args.markdown === "string" ? args.markdown : undefined,
        ...folderTarget(args),
      });
      if (!parsed.success) return { result: validationError(parsed.error) };
      return enqueue(ctx, parsed.data);
    }

    case "read_doc": {
      const missing = await missingPlugins(ctx, ["googledrive"]);
      if (missing.length > 0) return { result: notConnected(missing) };
      const documentId = str(args.documentId);
      if (!documentId) return { result: { error: "documentId is required" } };
      const doc = await workspace.docsReadText(tenantId, {
        documentId: extractGoogleFileId(documentId),
        maxChars: 20_000,
      });
      return { result: { title: doc.title, truncated: doc.truncated, text: fenceEmailData(doc.text) } };
    }

    case "create_meet_link": {
      const missing = await missingPlugins(ctx, ["googlemeet"]);
      if (missing.length > 0) return { result: notConnected(missing) };
      const space = await workspace.meetCreateSpace(tenantId);
      return {
        result: { meetingUri: space.meetingUri, meetingCode: space.meetingCode },
        card: {
          kind: "workspace",
          title: "Google Meet link ready",
          detail: space.meetingUri,
          href: space.meetingUri,
          lines: [space.meetingUri],
        },
      };
    }

    case "list_meet_conferences": {
      const missing = await missingPlugins(ctx, ["googlemeet"]);
      if (missing.length > 0) return { result: notConnected(missing) };
      const conferences = await workspace.meetListConferences(tenantId, {
        maxResults: clampNumber(args.maxResults, 10, 1, 20),
      });
      return { result: { count: conferences.length, conferences } };
    }

    case "get_meet_transcript": {
      const missing = await missingPlugins(ctx, ["googlemeet"]);
      if (missing.length > 0) return { result: notConnected(missing) };
      const conferenceRecord = str(args.conferenceRecord);
      if (!conferenceRecord) return { result: { error: "conferenceRecord is required" } };
      const transcript = await workspace.meetGetTranscript(tenantId, {
        conferenceRecord,
        maxChars: 30_000,
      });
      if (!transcript) {
        return {
          result: {
            error:
              "No transcript for this meeting. Transcripts exist only when transcription was turned on in Meet (Google Workspace plans).",
          },
        };
      }
      return {
        result: {
          conferenceRecord: transcript.conferenceRecord,
          truncated: transcript.truncated,
          transcript: fenceEmailData(transcript.text),
        },
      };
    }

    default:
      return null;
  }
}
