import { serviceError } from "@repo/services/errors";
import { WORKSPACE_PLUGIN_LABELS, driveFileUrl, type WorkspaceService } from "@repo/services/workspace";
import {
  fileSourceKey,
  workspaceActionRequirements,
  type WorkspaceActionPayload,
  type WorkspaceActionResult,
} from "@repo/services/workspace/schemas";

type Completed = Array<{ key: string; name: string; url: string }>;

async function resolveFolder(
  workspace: WorkspaceService,
  tenantId: string,
  target: { folderId?: string; folderName?: string },
): Promise<{ id: string; url: string; name?: string } | undefined> {
  if (target.folderId) {
    return { id: target.folderId, url: driveFileUrl({ id: target.folderId, isFolder: true }) };
  }
  if (!target.folderName) return undefined;
  const existing = await workspace.driveFindFolderByName(tenantId, target.folderName);
  const folder = existing ?? (await workspace.driveCreateFolder(tenantId, { name: target.folderName }));
  return { id: folder.id, url: driveFileUrl(folder), name: folder.name };
}

/**
 * Runs an approved workspace_action queue item. `saveProgress` persists partial work
 * (uploaded files) so a retry after a mid-way failure does not duplicate uploads.
 */
export async function executeWorkspaceAction(
  workspace: WorkspaceService,
  tenantId: string,
  payload: WorkspaceActionPayload,
  saveProgress: (completed: Completed) => Promise<void>,
): Promise<WorkspaceActionResult> {
  const status = await workspace.getConnectionStatus(tenantId);
  const missing = workspaceActionRequirements(payload).filter((p) => status[p] !== "connected");
  if (missing.length > 0) {
    throw serviceError(
      "PRECONDITION_FAILED",
      `Connect ${missing.map((p) => WORKSPACE_PLUGIN_LABELS[p]).join(" and ")} from the Workspace menu to run this.`,
    );
  }

  switch (payload.action) {
    case "drive_save_files": {
      const folder = await resolveFolder(workspace, tenantId, payload);
      const completed: Completed = [...(payload.completed ?? [])];
      const done = new Set(completed.map((c) => c.key));
      const failures: string[] = [];

      for (const source of payload.files) {
        const key = fileSourceKey(source);
        if (done.has(key)) continue;
        try {
          let data: Uint8Array;
          if (source.type === "gmail_attachment") {
            data = await workspace.readGmailAttachment(tenantId, {
              messageId: source.messageId,
              attachmentId: source.attachmentId,
            });
          } else {
            const staged = await workspace.readStagedUpload(tenantId, source.uploadId);
            if (!staged) throw serviceError("NOT_FOUND", "the attached file expired — attach it again");
            data = staged.data;
          }
          const file = await workspace.driveUploadFile(tenantId, {
            name: source.filename,
            mimeType: source.mimeType,
            data,
            parentId: folder?.id,
          });
          completed.push({ key, name: file.name, url: driveFileUrl(file) });
          done.add(key);
        } catch (error) {
          failures.push(`${source.filename}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (failures.length > 0) {
        if (completed.length > (payload.completed?.length ?? 0)) await saveProgress(completed);
        const saved = completed.length > 0 ? ` ${completed.length} file(s) already saved; retry uploads only the rest.` : "";
        throw serviceError("PRECONDITION_FAILED", `Could not save ${failures.join("; ")}.${saved}`);
      }

      return {
        url: folder?.url ?? completed[0]?.url,
        label: folder ? `Open ${folder.name ?? "folder"} in Drive` : "Open in Drive",
        links: completed.map((c) => ({ label: c.name, url: c.url })),
      };
    }

    case "drive_create_folder": {
      const folder = await workspace.driveCreateFolder(tenantId, {
        name: payload.name,
        parentId: payload.parentFolderId,
      });
      return { url: driveFileUrl(folder), label: `Open ${folder.name}` };
    }

    case "drive_move_file": {
      const folder = await resolveFolder(workspace, tenantId, payload);
      if (!folder) throw serviceError("BAD_REQUEST", "No destination folder was given");
      const file = await workspace.driveMoveFile(tenantId, { fileId: payload.fileId, folderId: folder.id });
      return { url: driveFileUrl(file), label: `Open ${file.name}` };
    }

    case "drive_share_file": {
      await workspace.driveShareFile(tenantId, {
        fileId: payload.fileId,
        email: payload.email,
        role: payload.role,
        notify: payload.notify,
        message: payload.message,
      });
      return {
        url: driveFileUrl({ id: payload.fileId, isFolder: false }),
        label: `Shared with ${payload.email}`,
      };
    }

    case "sheets_create": {
      const folder = await resolveFolder(workspace, tenantId, payload);
      const sheet = await workspace.sheetsCreate(tenantId, {
        title: payload.title,
        rows: payload.rows,
        folderId: folder?.id,
      });
      return { url: sheet.url, label: `Open ${payload.title}` };
    }

    case "sheets_append_rows": {
      const res = await workspace.sheetsAppendRows(tenantId, {
        spreadsheetId: payload.spreadsheetId,
        sheetName: payload.sheetName,
        rows: payload.rows,
      });
      return { url: res.url, label: `Added ${res.updatedRows} row(s)` };
    }

    case "docs_create": {
      const folder = await resolveFolder(workspace, tenantId, payload);
      const doc = await workspace.docsCreate(tenantId, {
        title: payload.title,
        markdown: payload.markdown,
        folderId: folder?.id,
      });
      return { url: doc.url, label: `Open ${payload.title}` };
    }
  }
}
