import { z } from "zod";

import { getMeetingService } from "@repo/services/meetings";
import { getWorkspaceService } from "@repo/services/workspace";

import { mapServiceError, protectedProcedure, router } from "../../trpc";

const idInput = z.object({ id: z.string().uuid() });

/** Thread meetings: live-captured or uploaded, transcribed by Gnani. Audio itself goes over REST. */
export const meetingsRouter = router({
  status: protectedProcedure.input(z.object({})).query(async ({ ctx }) => {
    let meetConnected = false;
    try {
      const status = await getWorkspaceService().getConnectionStatus(ctx.user.id);
      meetConnected = status.googlemeet === "connected";
    } catch {
      meetConnected = false;
    }
    return { transcriptionConfigured: getMeetingService().isTranscriptionConfigured(), meetConnected };
  }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        return { meetings: await getMeetingService().list(ctx.user.id, { limit: input.limit }) };
      } catch (error) {
        mapServiceError(error);
      }
    }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return await getMeetingService().get(ctx.user.id, input.id);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  /**
   * Creates a meeting room. With createMeetLink, also opens a fresh Google Meet space
   * (needs Meet connected) so the room can launch it next to the live transcript.
   */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().max(200).optional(),
        languageCode: z.string().trim().max(20).optional(),
        mode: z.enum(["live", "upload"]).default("live"),
        meetUrl: z
          .string()
          .trim()
          .max(500)
          .regex(/^https:\/\/meet\.google\.com\//, "Paste a meet.google.com link")
          .optional(),
        createMeetLink: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        let meetUrl = input.meetUrl;
        if (input.createMeetLink && !meetUrl) {
          const space = await getWorkspaceService().meetCreateSpace(ctx.user.id);
          meetUrl = space.meetingUri;
        }
        return await getMeetingService().create(ctx.user.id, {
          title: input.title,
          languageCode: input.languageCode,
          mode: input.mode,
          meetUrl,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  rename: protectedProcedure
    .input(idInput.extend({ title: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await getMeetingService().rename(ctx.user.id, input.id, input.title);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  end: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return await getMeetingService().end(ctx.user.id, input.id);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  refreshNotes: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return await getMeetingService().refreshNotes(ctx.user.id, input.id);
    } catch (error) {
      mapServiceError(error);
    }
  }),

  remove: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      await getMeetingService().remove(ctx.user.id, input.id);
      return { ok: true };
    } catch (error) {
      mapServiceError(error);
    }
  }),
});
