import { z } from "zod";

import { getCalendarService } from "@repo/services/calendar";

import { protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Calendar"];
const getPath = generatePath("/calendar");

const connectionStateSchema = z.enum([
  "connected",
  "missing_credentials",
  "not_connected",
  "not_configured",
]);

const calendarEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  htmlLink: z.string().optional(),
  status: z.string().optional(),
});

export const calendarRouter = router({
  connectionStatus: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/connection-status"), tags: TAGS } })
    .input(z.object({}))
    .output(
      z.object({
        googlecalendar: connectionStateSchema,
      }),
    )
    .query(async ({ ctx }) => {
      const calendar = getCalendarService();
      return calendar.getConnectionStatus(ctx.user.id);
    }),

  listEvents: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/events"), tags: TAGS } })
    .input(
      z.object({
        timeMin: z.string().min(1),
        timeMax: z.string().min(1),
        maxResults: z.number().int().min(1).max(100).optional(),
      }),
    )
    .output(
      z.object({
        events: z.array(calendarEventSchema),
      }),
    )
    .query(async ({ ctx, input }) => {
      const calendar = getCalendarService();
      return calendar.listEvents(ctx.user.id, input);
    }),

  createEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events"), tags: TAGS } })
    .input(
      z.object({
        summary: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        location: z.string().max(500).optional(),
        startDateTime: z.string().min(1),
        endDateTime: z.string().min(1),
        timeZone: z.string().max(64).optional(),
        attendeeEmails: z.array(z.string().email()).max(20).optional(),
      }),
    )
    .output(calendarEventSchema)
    .mutation(async ({ ctx, input }) => {
      const calendar = getCalendarService();
      return calendar.createEvent(ctx.user.id, input);
    }),

  cancelEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events/{eventId}/cancel"), tags: TAGS } })
    .input(z.object({ eventId: z.string().min(1) }))
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const calendar = getCalendarService();
      return calendar.cancelEvent(ctx.user.id, input.eventId);
    }),

  deleteEvent: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/events/{eventId}"), tags: TAGS } })
    .input(z.object({ eventId: z.string().min(1) }))
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const calendar = getCalendarService();
      return calendar.deleteEvent(ctx.user.id, input.eventId);
    }),
});
