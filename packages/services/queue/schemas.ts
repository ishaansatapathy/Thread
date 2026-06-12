import { z } from "zod";

import {
  emailBodySchema,
  safeEmailSubjectSchema,
  singleRecipientSchema,
} from "../validation/email";

export const emailQueuePayloadSchema = z.object({
  to: singleRecipientSchema,
  subject: safeEmailSubjectSchema,
  body: emailBodySchema,
  threadId: z.string().optional(),
});

export const calendarQueuePayloadSchema = z.object({
  summary: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  timeZone: z.string().max(64).optional(),
  attendeeEmails: z.array(z.string().email()).max(20).optional(),
});

export const calendarArchivePayloadSchema = z.object({
  eventId: z.string().min(1),
  summary: z.string().min(1).max(200),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  timeZone: z.string().max(64).optional(),
  htmlLink: z.string().optional(),
});

export const calendarDeletePayloadSchema = z.object({
  eventId: z.string().min(1),
  summary: z.string().min(1).max(200),
  htmlLink: z.string().optional(),
});

export const meetingBundlePayloadSchema = z.object({
  email: emailQueuePayloadSchema,
  calendar: calendarQueuePayloadSchema,
});

export function parseEmailQueuePayload(payload: Record<string, unknown>) {
  return emailQueuePayloadSchema.parse(payload);
}

export function parseCalendarQueuePayload(payload: Record<string, unknown>) {
  return calendarQueuePayloadSchema.parse(payload);
}

export function parseCalendarArchivePayload(payload: Record<string, unknown>) {
  return calendarArchivePayloadSchema.parse(payload);
}

export function parseCalendarDeletePayload(payload: Record<string, unknown>) {
  return calendarDeletePayloadSchema.parse(payload);
}

export function parseMeetingBundlePayload(payload: Record<string, unknown>) {
  return meetingBundlePayloadSchema.parse(payload);
}
