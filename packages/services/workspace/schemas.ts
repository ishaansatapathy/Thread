import { z } from "zod";

const idSchema = z.string().trim().min(1).max(256);
const nameSchema = z.string().trim().min(1).max(200);
const mimeTypeSchema = z.string().trim().min(1).max(200);
const cellSchema = z.string().max(5000);
const rowsSchema = z.array(z.array(cellSchema).max(60)).max(500);

const CHOICE_TYPES = new Set(["multiple_choice", "checkboxes", "dropdown"]);

const formQuestionSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    type: z.enum(["short_answer", "paragraph", "multiple_choice", "checkboxes", "dropdown"]),
    options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    required: z.boolean().optional(),
    points: z.number().int().min(0).max(1000).optional(),
    correctAnswers: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  })
  .superRefine((q, ctx) => {
    if (CHOICE_TYPES.has(q.type) && (q.options?.length ?? 0) < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: `${q.type} needs at least 2 options` });
    }
    if (q.correctAnswers?.length && CHOICE_TYPES.has(q.type)) {
      const missing = q.correctAnswers.filter((a) => !q.options?.includes(a));
      if (missing.length) {
        ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: `not among options: ${missing.join(", ")}` });
      }
    }
  });

const questionsSchema = z.array(formQuestionSchema).min(1).max(50);

/** ISO 8601 date (2026-10-25) or date-time with offset (2026-10-25T23:59:00+05:30). */
const dueDateSchema = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "dueDate must be an ISO 8601 date or date-time" });

const slideSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bullets: z.array(z.string().max(500)).max(20),
});

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
  z.object({
    action: z.literal("forms_create"),
    title: nameSchema,
    description: z.string().max(5000).optional(),
    questions: questionsSchema,
    isQuiz: z.boolean().optional(),
    ...folderTargetFields,
  }),
  z.object({
    action: z.literal("forms_add_questions"),
    formId: idSchema,
    formTitle: nameSchema.optional(),
    questions: questionsSchema,
  }),
  z.object({
    action: z.literal("slides_create"),
    title: nameSchema,
    outline: z.array(slideSchema).min(1).max(50),
    ...folderTargetFields,
  }),
  z.object({
    action: z.literal("classroom_post_announcement"),
    courseId: idSchema,
    courseName: nameSchema.optional(),
    text: z.string().trim().min(1).max(10_000),
  }),
  z.object({
    action: z.literal("classroom_create_coursework"),
    courseId: idSchema,
    courseName: nameSchema.optional(),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10_000).optional(),
    dueDate: dueDateSchema.optional(),
    maxPoints: z.number().min(0).max(10_000).optional(),
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
export function workspaceActionRequirements(
  payload: WorkspaceActionPayload,
): Array<"googledrive" | "googlesheets" | "googleforms" | "googleslides" | "googleclassroom"> {
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
    case "forms_create":
      return payload.folderId || payload.folderName ? ["googleforms", "googledrive"] : ["googleforms"];
    case "forms_add_questions":
      return ["googleforms"];
    case "slides_create":
      return payload.folderId || payload.folderName ? ["googleslides", "googledrive"] : ["googleslides"];
    case "classroom_post_announcement":
    case "classroom_create_coursework":
      return ["googleclassroom"];
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
    case "forms_create":
      return {
        title: `Create ${payload.isQuiz ? "quiz" : "form"} "${payload.title}"`,
        preview: `${payload.questions.length} question${payload.questions.length === 1 ? "" : "s"}${folderSuffix(payload)}`,
      };
    case "forms_add_questions":
      return {
        title: `Add ${payload.questions.length} question${payload.questions.length === 1 ? "" : "s"} to ${payload.formTitle ?? "form"}`,
        preview: payload.questions
          .slice(0, 3)
          .map((q) => q.title)
          .join(" · "),
      };
    case "slides_create":
      return {
        title: `Create presentation "${payload.title}"`,
        preview: `${payload.outline.length} slide${payload.outline.length === 1 ? "" : "s"}`,
      };
    case "classroom_post_announcement":
      return {
        title: `Post announcement to ${payload.courseName ?? "course"}`,
        preview: payload.text.replace(/\s+/g, " ").slice(0, 200),
      };
    case "classroom_create_coursework":
      return {
        title: `Create assignment "${payload.title}" in ${payload.courseName ?? "course"}`,
        preview: [payload.dueDate ? `Due ${payload.dueDate}` : "No due date", payload.maxPoints !== undefined ? `${payload.maxPoints} pts` : ""]
          .filter(Boolean)
          .join(" · "),
      };
  }
}
