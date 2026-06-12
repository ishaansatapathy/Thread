import { z } from "zod";

import { getCalendarService } from "@repo/services/calendar";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Calendar"];
const getPath = generatePath("/calendar");

const connectionStateSchema = z.enum([
  "connected",
  "missing_credentials",
  "not_connected",
  "not_configured",
]);

const calendarAttendeeSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  responseStatus: z.string().optional(),
  organizer: z.boolean().optional(),
  optional: z.boolean().optional(),
});

const calendarEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  allDay: z.boolean().optional(),
  htmlLink: z.string().optional(),
  hangoutLink: z.string().optional(),
  status: z.string().optional(),
  recurringEventId: z.string().optional(),
  isRecurring: z.boolean().optional(),
  attendees: z.array(calendarAttendeeSchema).optional(),
});

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO date/time",
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
        timeMin: isoDateTimeSchema,
        timeMax: isoDateTimeSchema,
        maxResults: z.number().int().min(1).max(250).optional(),
        timeZone: z.string().max(64).optional(),
        pageToken: z.string().optional(),
      }),
    )
    .output(
      z.object({
        events: z.array(calendarEventSchema),
        nextPageToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.listEvents(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  createEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events"), tags: TAGS } })
    .input(
      z.object({
        summary: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        location: z.string().max(500).optional(),
        startDateTime: isoDateTimeSchema,
        endDateTime: isoDateTimeSchema,
        timeZone: z.string().max(64).optional(),
        attendeeEmails: z.array(z.string().email()).max(20).optional(),
      }),
    )
    .output(calendarEventSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.createEvent(ctx.user.id, input);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  cancelEvent: protectedProcedure
    .meta({ openapi: { method: "POST", path: getPath("/events/{eventId}/cancel"), tags: TAGS } })
    .input(z.object({ eventId: z.string().min(1) }))
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.cancelEvent(ctx.user.id, input.eventId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  deleteEvent: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: getPath("/events/{eventId}"), tags: TAGS } })
    .input(z.object({ eventId: z.string().min(1) }))
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const calendar = getCalendarService();
        return await calendar.deleteEvent(ctx.user.id, input.eventId);
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
