import { z } from "zod";

const idSchema = z.string().trim().min(1).max(256);
const nameSchema = z.string().trim().min(1).max(200);
const mimeTypeSchema = z.string().trim().min(1).max(200);
const cellSchema = z.string().max(5000);
const rowsSchema = z.array(z.array(cellSchema).max(60)).max(500);

export const gmailAttachmentSourceSchema = z.object({
  type: z.literal("gmail_attachment"),
  messageId: idSchema,
  attachmentId: z.string().trim().min(1).max(2000),
  filename: nameSchema,
  mimeType: mimeTypeSchema,
});

export const stagedUploadSourceSchema = z.object({
  type: z.literal("upload"),
  uploadId: z.string().uuid(),
  filename: nameSchema,
  mimeType: mimeTypeSchema,
});

export const workspaceFileSourceSchema = z.discriminatedUnion("type", [
  gmailAttachmentSourceSchema,
  stagedUploadSourceSchema,
]);

const folderTargetFields = {
  /** Existing Drive folder id. Wins over folderName. */
  folderId: idSchema.optional(),
  /** Folder name — reused if it already exists at the target level, created otherwise. */
  folderName: nameSchema.optional(),
};

export const workspaceActionPayloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("drive_save_files"),
    files: z.array(workspaceFileSourceSchema).min(1).max(10),
    ...folderTargetFields,
    /** Sources already uploaded by an earlier, partially failed approval (see fileSourceKey). */
    completed: z
      .array(z.object({ key: z.string(), name: z.string(), url: z.string() }))
      .max(10)
      .optional(),
  }),
  z.object({
    action: z.literal("drive_create_folder"),
    name: nameSchema,
    parentFolderId: idSchema.optional(),
  }),
  z.object({
    action: z.literal("drive_move_file"),
    fileId: idSchema,
    fileName: nameSchema,
    ...folderTargetFields,
  }),
  z.object({
    action: z.literal("drive_share_file"),
    fileId: idSchema,
    fileName: nameSchema,
    email: z.string().trim().email(),
    role: z.enum(["reader", "commenter", "writer"]),
    notify: z.boolean(),
    message: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("sheets_create"),
    title: nameSchema,
    rows: rowsSchema.optional(),
    ...folderTargetFields,
  }),
  z.object({
    action: z.literal("sheets_append_rows"),
    spreadsheetId: idSchema,
    spreadsheetTitle: nameSchema.optional(),
    sheetName: z.string().trim().min(1).max(100).optional(),
    rows: rowsSchema.min(1),
  }),
  z.object({
    action: z.literal("docs_create"),
    title: nameSchema,
    markdown: z.string().min(1).max(100_000),
    ...folderTargetFields,
  }),
]);

export type WorkspaceActionPayload = z.infer<typeof workspaceActionPayloadSchema>;
export type WorkspaceAction = WorkspaceActionPayload["action"];
export type WorkspaceFileSource = z.infer<typeof workspaceFileSourceSchema>;

export const workspaceActionResultSchema = z.object({
  url: z.string().optional(),
  label: z.string().optional(),
  links: z.array(z.object({ label: z.string(), url: z.string() })).max(20).optional(),
});
export type WorkspaceActionResult = z.infer<typeof workspaceActionResultSchema>;

export function fileSourceKey(source: WorkspaceFileSource): string {
  return source.type === "gmail_attachment"
    ? `gmail:${source.messageId}:${source.attachmentId}`
    : `upload:${source.uploadId}`;
}

export function parseWorkspaceActionPayload(payload: Record<string, unknown>) {
  return workspaceActionPayloadSchema.parse(payload);
}

/** Which Workspace plugin must be connected for a queued action to run. */
export function workspaceActionRequirements(payload: WorkspaceActionPayload): Array<
  "googledrive" | "googlesheets"
> {
  switch (payload.action) {
    case "drive_save_files":
    case "drive_create_folder":
    case "drive_move_file":
    case "drive_share_file":
    case "docs_create":
      return ["googledrive"];
    case "sheets_create":
      return payload.folderId || payload.folderName ? ["googlesheets", "googledrive"] : ["googlesheets"];
    case "sheets_append_rows":
      return ["googlesheets"];
  }
}

function folderSuffix(payload: { folderId?: string; folderName?: string }) {
  if (payload.folderName) return ` → ${payload.folderName}`;
  if (payload.folderId) return " → selected folder";
  return "";
}

export function describeWorkspaceAction(payload: WorkspaceActionPayload): { title: string; preview: string } {
  switch (payload.action) {
    case "drive_save_files": {
      const names = payload.files.map((f) => f.filename);
      const title =
        names.length === 1 ? `Save ${names[0]} to Drive` : `Save ${names.length} files to Drive`;
      return { title, preview: `${names.join(", ")}${folderSuffix(payload)}` };
    }
    case "drive_create_folder":
      return { title: `Create Drive folder "${payload.name}"`, preview: "New folder in Google Drive" };
    case "drive_move_file":
      return { title: `Move ${payload.fileName}`, preview: `Google Drive${folderSuffix(payload)}` };
    case "drive_share_file":
      return {
        title: `Share ${payload.fileName}`,
        preview: `${payload.email} · ${payload.role}${payload.notify ? " · notify by email" : ""}`,
      };
    case "sheets_create": {
      const rowCount = payload.rows?.length ?? 0;
      return {
        title: `Create sheet "${payload.title}"`,
        preview: `${rowCount} row${rowCount === 1 ? "" : "s"}${folderSuffix(payload)}`,
      };
    }
    case "sheets_append_rows":
      return {
        title: `Add ${payload.rows.length} row${payload.rows.length === 1 ? "" : "s"} to ${payload.spreadsheetTitle ?? "sheet"}`,
        preview: payload.rows
          .slice(0, 3)
          .map((row) => row.join(" | "))
          .join(" · "),
      };
    case "docs_create":
      return {
        title: `Create doc "${payload.title}"`,
        preview: `${payload.markdown.replace(/\s+/g, " ").slice(0, 200)}${folderSuffix(payload)}`,
      };
  }
}
