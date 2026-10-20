import { z } from "zod";

import { getQueueService } from "@repo/services/queue";
import { WORKSPACE_PLUGINS, driveFileUrl, getWorkspaceService } from "@repo/services/workspace";
import { describeWorkspaceAction, workspaceActionPayloadSchema } from "@repo/services/workspace/schemas";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Workspace"];
const getPath = generatePath("/workspace");

const connectionStateSchema = z.enum(["connected", "missing_credentials", "not_connected", "not_configured"]);

const queueItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("workspace_action"),
  title: z.string(),
  preview: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  sourceThreadId: z.string().optional(),
  status: z.enum(["pending", "processing", "approved", "dismissed", "failed"]),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});

export const workspaceRouter = router({
  connectionStatus: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/connection-status"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        googledrive: connectionStateSchema,
        googlesheets: connectionStateSchema,
        googlemeet: connectionStateSchema,
      }),
    )
    .query(async ({ ctx }) => {
      try {
        return await getWorkspaceService().getConnectionStatus(ctx.user.id);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  disconnect: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/disconnect"), tags: TAGS } })
    .input(z.object({ plugin: z.enum(WORKSPACE_PLUGINS) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await getWorkspaceService().disconnect(ctx.user.id, input.plugin);
        return { ok: true };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listFiles: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/files"), tags: TAGS } })
    .input(
      z.object({
        app: z.enum(["drive", "docs", "sheets"]),
        query: z.string().trim().max(200).optional(),
      }),
    )
    .output(
      z.object({
        files: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            mimeType: z.string().optional(),
            isFolder: z.boolean(),
            url: z.string(),
            modifiedTime: z.string().optional(),
            size: z.number().optional(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const mimeType =
          input.app === "docs"
            ? "application/vnd.google-apps.document"
            : input.app === "sheets"
              ? "application/vnd.google-apps.spreadsheet"
              : undefined;
        const files = await getWorkspaceService().driveListFiles(ctx.user.id, {
          query: input.query || undefined,
          mimeType,
          maxResults: 30,
        });
        return {
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            isFolder: f.isFolder,
            url: driveFileUrl(f),
            modifiedTime: f.modifiedTime,
            size: f.size,
          })),
        };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  listMeetings: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/meet/conferences"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        meetings: z.array(
          z.object({
            name: z.string(),
            startTime: z.string().optional(),
            endTime: z.string().optional(),
          }),
        ),
      }),
    )
    .query(async ({ ctx }) => {
      try {
        const meetings = await getWorkspaceService().meetListConferences(ctx.user.id, { maxResults: 20 });
        return { meetings: meetings.map((m) => ({ name: m.name, startTime: m.startTime, endTime: m.endTime })) };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /** Queue saving one or more Gmail attachments to Drive (approve in Queue to run). */
  queueSaveAttachments: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/drive/save-attachments"), tags: TAGS } })
    .input(
      z.object({
        messageId: z.string().min(1).max(256),
        threadId: z.string().max(256).optional(),
        attachments: z
          .array(
            z.object({
              attachmentId: z.string().min(1).max(2000),
              filename: z.string().min(1).max(200),
              mimeType: z.string().min(1).max(200),
            }),
          )
          .min(1)
          .max(10),
        folderName: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .output(queueItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const payload = workspaceActionPayloadSchema.parse({
          action: "drive_save_files",
          files: input.attachments.map((a) => ({
            type: "gmail_attachment",
            messageId: input.messageId,
            attachmentId: a.attachmentId,
            filename: a.filename,
            mimeType: a.mimeType,
          })),
          folderName: input.folderName,
        });
        const { title, preview } = describeWorkspaceAction(payload);
        const item = await getQueueService().enqueueWorkspaceAction(
          ctx.user.id,
          { payload, title, preview, sourceThreadId: input.threadId },
          { origin: "inbox" },
        );
        return { ...item, kind: "workspace_action" as const };
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
