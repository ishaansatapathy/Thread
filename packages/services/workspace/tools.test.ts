import { describe, expect, it, vi } from "vitest";

import type { QueueItem, QueueService } from "../queue";
import type { WorkspaceConnectionStatus, WorkspaceService } from "./index";
import { executeWorkspaceTool, extractGoogleFileId } from "./tools";

const allConnected: WorkspaceConnectionStatus = {
  googledrive: "connected",
  googlesheets: "connected",
  googlemeet: "connected",
};

function fakes(status: WorkspaceConnectionStatus = allConnected) {
  const enqueued: Array<{ payload: unknown; title?: string }> = [];
  const queue = {
    enqueueWorkspaceAction: vi.fn(async (_userId: string, input: { payload: unknown; title?: string }) => {
      enqueued.push(input);
      return {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "workspace_action",
        title: input.title ?? "",
        payload: input.payload as Record<string, unknown>,
        status: "pending",
        createdAt: new Date().toISOString(),
      } satisfies QueueItem;
    }),
  } as unknown as QueueService;
  const workspace = {
    getConnectionStatus: vi.fn(async () => status),
    getStagedUploadMeta: vi.fn(async (_t: string, id: string) =>
      id === "22222222-2222-4222-8222-222222222222"
        ? { id, filename: "receipt.pdf", mimeType: "application/pdf", size: 10 }
        : null,
    ),
    driveListFiles: vi.fn(async () => [{ id: "f1", name: "Invoices", isFolder: true }]),
  } as unknown as WorkspaceService;
  return { queue, workspace, enqueued, ctx: { tenantId: "u1", queue, workspace, origin: "agent" as const } };
}

describe("executeWorkspaceTool", () => {
  it("returns null for tools it does not own", async () => {
    const { ctx } = fakes();
    expect(await executeWorkspaceTool("list_inbox", {}, ctx)).toBeNull();
  });

  it("queues a Gmail attachment + chat upload save into a named folder", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool(
      "queue_drive_save_files",
      {
        gmailAttachments: [
          { messageId: "m1", attachmentId: "a1", filename: "[EMAIL_DATA_START]Q3.pdf[EMAIL_DATA_END]", mimeType: "application/pdf" },
        ],
        uploadIds: ["22222222-2222-4222-8222-222222222222"],
        folderName: "Q3 Contracts",
      },
      ctx,
    );
    expect(out?.card).toMatchObject({ kind: "workspace_queued", disposition: "queued" });
    expect(enqueued[0]?.payload).toMatchObject({
      action: "drive_save_files",
      folderName: "Q3 Contracts",
      files: [
        { type: "gmail_attachment", messageId: "m1", attachmentId: "a1", filename: "Q3.pdf" },
        { type: "upload", uploadId: "22222222-2222-4222-8222-222222222222", filename: "receipt.pdf" },
      ],
    });
  });

  it("refuses unknown or expired chat uploads instead of queueing", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool(
      "queue_drive_save_files",
      { uploadIds: ["33333333-3333-4333-8333-333333333333"] },
      ctx,
    );
    expect(out?.result).toMatchObject({ error: expect.stringContaining("expired") });
    expect(enqueued).toHaveLength(0);
  });

  it("reports which app to connect when the plugin is missing", async () => {
    const { ctx, enqueued } = fakes({ ...allConnected, googlesheets: "not_connected" });
    const out = await executeWorkspaceTool("queue_sheet_create", { title: "Budget", rows: [["a"]] }, ctx);
    expect(out?.result).toMatchObject({ notConnected: ["googlesheets"] });
    expect(enqueued).toHaveLength(0);
  });

  it("runs Google Docs on the Drive connection", async () => {
    const { ctx, enqueued } = fakes({ ...allConnected, googledrive: "not_connected" });
    const out = await executeWorkspaceTool("queue_doc_create", { title: "Notes", markdown: "# Hi" }, ctx);
    expect(out?.result).toMatchObject({ notConnected: ["googledrive"] });
    expect(enqueued).toHaveLength(0);
  });

  it("needs Drive too when a sheet goes into a folder", async () => {
    const { ctx } = fakes({ ...allConnected, googledrive: "not_connected" });
    const out = await executeWorkspaceTool("queue_sheet_create", { title: "Budget", folderName: "Finance" }, ctx);
    expect(out?.result).toMatchObject({ notConnected: ["googledrive"] });
  });

  it("coerces model rows to strings and accepts sheet URLs as ids", async () => {
    const { ctx, enqueued } = fakes();
    await executeWorkspaceTool(
      "queue_sheet_append_rows",
      {
        spreadsheetId: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0",
        rows: [[1, null, "x"], "not-a-row"],
      },
      ctx,
    );
    expect(enqueued[0]?.payload).toMatchObject({
      spreadsheetId: "1AbCdEfGhIjKlMnOp",
      rows: [["1", "", "x"]],
    });
  });

  it("returns validation issues instead of throwing on bad input", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("queue_drive_share_file", { fileId: "f", fileName: "x", email: "nope" }, ctx);
    expect(out?.result).toMatchObject({ error: "Invalid arguments" });
  });

  it("requires a destination for moves", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("queue_drive_move_file", { fileId: "f", fileName: "x" }, ctx);
    expect(out?.result).toMatchObject({ error: expect.stringContaining("folderId or folderName") });
  });

  it("fences Drive names returned to the model", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("search_drive", { query: "Inv" }, ctx);
    const files = (out?.result as { files: Array<{ name: string }> }).files;
    expect(files[0]?.name).toContain("[EMAIL_DATA_START]");
  });
});

describe("extractGoogleFileId", () => {
  it("handles bare ids and doc/sheet URLs", () => {
    expect(extractGoogleFileId("abc")).toBe("abc");
    expect(extractGoogleFileId("https://docs.google.com/document/d/1xYz_abc-123456/edit")).toBe("1xYz_abc-123456");
  });
});
