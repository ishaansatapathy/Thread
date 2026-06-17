import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import {
  resolveCalendarEventId,
  type CalendarConnectionStatus,
  type CalendarEditScope,
  type CalendarEvent,
  type CalendarService,
} from "@repo/services/calendar";
import { getCorsair, getCorsairCalendarRedirectUri, isCorsairConfigured } from "../corsair";
import { getCorsairOAuthModule } from "../corsair-imports";
import { env } from "../env";
import { clearCalendarChannel, getCalendarChannel, setCalendarChannel } from "./calendar-state";
import { ensureCorsairTenant } from "./corsair-tenant";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatRruleUntilDateTime(isoStart: string) {
  const end = new Date(isoStart);
  end.setUTCSeconds(end.getUTCSeconds() - 1);
  return [
    end.getUTCFullYear(),
    pad2(end.getUTCMonth() + 1),
    pad2(end.getUTCDate()),
    "T",
    pad2(end.getUTCHours()),
    pad2(end.getUTCMinutes()),
    pad2(end.getUTCSeconds()),
    "Z",
  ].join("");
}

function formatRruleUntilDate(isoDate: string) {
  const end = new Date(`${isoDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return [
    end.getUTCFullYear(),
    pad2(end.getUTCMonth() + 1),
    pad2(end.getUTCDate()),
  ].join("");
}

function truncateRecurrenceRules(recurrence: string[], splitStart: string, allDay: boolean) {
  const until = allDay ? formatRruleUntilDate(splitStart) : formatRruleUntilDateTime(splitStart);
  return recurrence.map((rule) => {
    if (!rule.startsWith("RRULE:")) return rule;
    const body = rule
      .slice(6)
      .split(";")
      .filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="))
      .join(";");
    return `RRULE:${body};UNTIL=${until}`;
  });
}

function mapEvent(event: {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    optional?: boolean;
  }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    hangoutLink?: string;
  };
}): CalendarEvent | null {
  if (!event.id) return null;
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  // Prefer top-level hangoutLink; fall back to conferenceData entry point.
  const meetLink =
    event.hangoutLink ??
    event.conferenceData?.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  return {
    id: event.id,
    summary: event.summary?.trim() || "Untitled event",
    description: event.description,
    location: event.location,
    start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date,
    allDay,
    htmlLink: event.htmlLink,
    hangoutLink: meetLink,
    status: event.status,
    recurringEventId: event.recurringEventId,
    isRecurring: Boolean(event.recurringEventId),
    attendees: event.attendees?.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
      organizer: attendee.organizer,
      optional: attendee.optional,
    })),
  };
}

export class CorsairCalendarService implements CalendarService {
  isConfigured() {
    if (!isCorsairConfigured()) return false;
    const google = getGoogleOAuthConfig();
    return Boolean(google.clientId && google.clientSecret);
  }

  async getConnectionStatus(tenantId: string): Promise<CalendarConnectionStatus> {
    if (!this.isConfigured()) {
      return { googlecalendar: "not_configured" };
    }

    try {
      await ensureCorsairTenant(tenantId);
      const status = await getCorsair().manage.connectionStatus.get({ tenantId });
      return { googlecalendar: status.googlecalendar ?? "not_connected" };
    } catch (error) {
      logger.warn("Calendar connection status failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { googlecalendar: "not_connected" };
    }
  }

  async getCalendarConnectUrl(tenantId: string) {
    if (!this.isConfigured()) {
      throw new Error("Calendar integration is not configured on the server");
    }

    await ensureCorsairTenant(tenantId);
    const corsair = getCorsair();
    const redirectUri = getCorsairCalendarRedirectUri();
    const { generateOAuthUrl } = getCorsairOAuthModule();
    const { url, state } = await generateOAuthUrl(corsair, "googlecalendar", {
      tenantId,
      redirectUri,
    });
    return { url, state, redirectUri };
  }

  async completeCalendarOAuth(input: { code: string; state: string }) {
    const corsair = getCorsair();
    const redirectUri = getCorsairCalendarRedirectUri();
    const { processOAuthCallback } = getCorsairOAuthModule();
    return processOAuthCallback(corsair, {
      code: input.code,
      state: input.state,
      redirectUri,
    });
  }

  async getEvent(tenantId: string, eventId: string): Promise<import("@repo/services/calendar").CalendarEvent | null> {
    if (!this.isConfigured()) return null;
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") return null;
    try {
      const corsair = getCorsair().withTenant(tenantId);
      const event = await corsair.googlecalendar.api.events.get({ calendarId: "primary", id: eventId });
      return mapEvent(event);
    } catch {
      return null;
    }
  }

  async listEvents(
    tenantId: string,
    opts: {
      timeMin: string;
      timeMax: string;
      maxResults?: number;
      timeZone?: string;
      pageToken?: string;
      q?: string;
    },
  ) {
    if (!this.isConfigured()) return { events: [] };

    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      return { events: [] };
    }

    const corsair = getCorsair().withTenant(tenantId);
    // singleEvents expands recurring series into individual instances and
    // annotates each with recurringEventId, which we surface as a badge.
    const result = await corsair.googlecalendar.api.events.getMany({
      calendarId: "primary",
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      timeZone: opts.timeZone?.trim() || undefined,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: Math.min(Math.max(opts.maxResults ?? 50, 1), 250),
      pageToken: opts.pageToken,
      ...(opts.q ? { q: opts.q } : {}),
    });

    const events = (result.items ?? [])
      .map(mapEvent)
      .filter((event: CalendarEvent | null): event is CalendarEvent => Boolean(event));

    return { events, nextPageToken: result.nextPageToken };
  }

  /**
   * Natural-language event creation via Google Calendar's quickAdd endpoint.
   * E.g. "Lunch with Sarah tomorrow at noon" → creates a real calendar event.
   * Returns the mapped CalendarEvent.
   */
  async quickAddEvent(tenantId: string, text: string): Promise<CalendarEvent> {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const result = await (corsair.googlecalendar.api.events as {
      quickAdd: (opts: { calendarId: string; text: string; sendUpdates?: string }) => Promise<Record<string, unknown>>;
    }).quickAdd({ calendarId: "primary", text, sendUpdates: "all" });

    const mapped = mapEvent(result);
    if (!mapped) throw new Error("quickAdd returned an unrecognizable event");
    return mapped;
  }

  async createEvent(
    tenantId: string,
    input: {
      summary: string;
      description?: string;
      location?: string;
      startDateTime: string;
      endDateTime: string;
      timeZone?: string;
      attendeeEmails?: string[];
      allDay?: boolean;
      recurrence?: string[];
      /** When true, auto-generates a Google Meet link via conferenceData. Defaults to true when attendees are provided. */
      addGoogleMeet?: boolean;
    },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    const timeZone = input.timeZone?.trim() || "UTC";
    const corsair = getCorsair().withTenant(tenantId);
    const start = input.allDay
      ? { date: input.startDateTime.slice(0, 10) }
      : { dateTime: input.startDateTime, timeZone };
    const end = input.allDay
      ? { date: input.endDateTime.slice(0, 10) }
      : { dateTime: input.endDateTime, timeZone };

    // Auto-add Google Meet when there are attendees or explicitly requested.
    const addMeet = input.addGoogleMeet ?? (Boolean(input.attendeeEmails?.length));
    const conferenceData = addMeet
      ? { createRequest: { requestId: `corsair-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } }
      : undefined;

    const created = await (corsair.googlecalendar.api.events as {
      create: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }).create({
      calendarId: "primary",
      sendUpdates: "all",
      ...(addMeet ? { conferenceDataVersion: 1 } : {}),
      event: {
        summary: input.summary,
        description: input.description,
        location: input.location,
        start,
        end,
        attendees: input.attendeeEmails?.map((email) => ({ email })),
        recurrence: input.recurrence?.length ? input.recurrence : undefined,
        ...(conferenceData ? { conferenceData } : {}),
      },
    });

    const mapped = mapEvent(created);
    if (!mapped) {
      throw new Error("Calendar event was created but returned no id");
    }
    return mapped;
  }

  async cancelEvent(tenantId: string, eventId: string) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const existing = await corsair.googlecalendar.api.events.get({
      calendarId: "primary",
      id: eventId,
    });

    await corsair.googlecalendar.api.events.update({
      calendarId: "primary",
      id: eventId,
      sendUpdates: "all",
      event: {
        summary: existing.summary,
        description: existing.description,
        location: existing.location,
        start: existing.start,
        end: existing.end,
        attendees: existing.attendees,
        status: "cancelled",
      },
    });

    return { success: true as const };
  }

  private async listFollowingInstances(
    tenantId: string,
    eventId: string,
    recurringEventId?: string,
  ): Promise<CalendarEvent[]> {
    const corsair = getCorsair().withTenant(tenantId);
    const instance = await corsair.googlecalendar.api.events.get({
      calendarId: "primary",
      id: eventId,
    });

    const masterId = recurringEventId ?? instance.recurringEventId;
    const from = instance.start?.dateTime ?? instance.start?.date;
    if (!masterId || !from) {
      const mapped = mapEvent(instance);
      return mapped ? [mapped] : [];
    }

    const twoYearsAhead = new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString();
    const listed = await this.listEvents(tenantId, {
      timeMin: from,
      timeMax: twoYearsAhead,
      maxResults: 250,
    });

    return listed.events.filter((event: CalendarEvent) => event.recurringEventId === masterId);
  }

  private async truncateMasterRecurrenceBefore(
    tenantId: string,
    eventId: string,
    recurringEventId?: string,
  ): Promise<string | undefined> {
    const corsair = getCorsair().withTenant(tenantId);
    const instance = await corsair.googlecalendar.api.events.get({
      calendarId: "primary",
      id: eventId,
    });

    const masterId = recurringEventId ?? instance.recurringEventId;
    const splitStart = instance.start?.dateTime ?? instance.start?.date;
    if (!masterId || !splitStart) return masterId ?? undefined;

    const master = await corsair.googlecalendar.api.events.get({
      calendarId: "primary",
      id: masterId,
    });
    if (!master.recurrence?.length) return masterId;

    const allDay = Boolean(instance.start?.date && !instance.start?.dateTime);
    await corsair.googlecalendar.api.events.patch({
      calendarId: "primary",
      id: masterId,
      sendUpdates: "all",
      event: {
        recurrence: truncateRecurrenceRules(master.recurrence, splitStart, allDay),
      },
    });

    return masterId;
  }

  private async deleteFollowingEvents(
    tenantId: string,
    eventId: string,
    recurringEventId?: string,
  ) {
    const corsair = getCorsair().withTenant(tenantId);
    await this.truncateMasterRecurrenceBefore(tenantId, eventId, recurringEventId);
    const instances = await this.listFollowingInstances(tenantId, eventId, recurringEventId);
    for (const event of instances) {
      await corsair.googlecalendar.api.events.delete({
        calendarId: "primary",
        id: event.id,
        sendUpdates: "all",
      });
    }
    return { success: true as const };
  }

  private async updateFollowingEventTimes(
    tenantId: string,
    eventId: string,
    input: { startDateTime: string; endDateTime: string; timeZone?: string; allDay?: boolean },
    recurringEventId?: string,
  ) {
    const corsair = getCorsair().withTenant(tenantId);
    const instance = await corsair.googlecalendar.api.events.get({
      calendarId: "primary",
      id: eventId,
    });
    const masterId = recurringEventId ?? instance.recurringEventId;

    await this.truncateMasterRecurrenceBefore(tenantId, eventId, masterId ?? undefined);

    const instances = await this.listFollowingInstances(tenantId, eventId, masterId ?? undefined);
    for (const event of instances) {
      await corsair.googlecalendar.api.events.delete({
        calendarId: "primary",
        id: event.id,
        sendUpdates: "all",
      });
    }

    let recurrence: string[] | undefined;
    if (masterId) {
      const master = await corsair.googlecalendar.api.events.get({
        calendarId: "primary",
        id: masterId,
      });
      recurrence = master.recurrence?.length ? master.recurrence : undefined;
    }

    const attendeeEmails = (instance.attendees ?? [])
      .map((attendee: { email?: string }) => attendee.email?.trim())
      .filter((email: string | undefined): email is string => Boolean(email));

    return this.createEvent(tenantId, {
      summary: instance.summary?.trim() || "Untitled event",
      description: instance.description,
      location: instance.location,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      timeZone: input.timeZone,
      allDay: input.allDay,
      recurrence,
      attendeeEmails: attendeeEmails.length ? attendeeEmails : undefined,
    });
  }

  async updateEventTimes(
    tenantId: string,
    eventId: string,
    input: { startDateTime: string; endDateTime: string; timeZone?: string; allDay?: boolean },
    opts?: { editScope?: CalendarEditScope; recurringEventId?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    if (opts?.editScope === "following") {
      return this.updateFollowingEventTimes(tenantId, eventId, input, opts.recurringEventId);
    }

    const scope = opts?.editScope === "series" ? "series" : "instance";
    const targetId = resolveCalendarEventId(eventId, opts?.recurringEventId, scope);
    const timeZone = input.timeZone?.trim() || "UTC";
    const corsair = getCorsair().withTenant(tenantId);
    const existing = await corsair.googlecalendar.api.events.get({
      calendarId: "primary",
      id: targetId,
    });

    const allDay = input.allDay ?? Boolean(existing.start?.date && !existing.start?.dateTime);
    const start = allDay
      ? { date: input.startDateTime.slice(0, 10) }
      : { dateTime: input.startDateTime, timeZone };
    const end = allDay
      ? { date: input.endDateTime.slice(0, 10) }
      : { dateTime: input.endDateTime, timeZone };

    const updated = await corsair.googlecalendar.api.events.update({
      calendarId: "primary",
      id: targetId,
      sendUpdates: "all",
      event: {
        summary: existing.summary,
        description: existing.description,
        location: existing.location,
        attendees: existing.attendees,
        start,
        end,
      },
    });

    const mapped = mapEvent(updated);
    if (!mapped) {
      throw new Error("Calendar event was updated but returned no id");
    }
    return mapped;
  }

  async patchEventDetails(
    tenantId: string,
    eventId: string,
    patch: { summary?: string; description?: string; location?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }
    const corsair = getCorsair().withTenant(tenantId);
    const updated = await corsair.googlecalendar.api.events.patch({
      calendarId: "primary",
      id: eventId,
      sendUpdates: "all",
      event: patch,
    });
    return mapEvent(updated);
  }

  async deleteEvent(
    tenantId: string,
    eventId: string,
    opts?: { editScope?: CalendarEditScope; recurringEventId?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    if (opts?.editScope === "following") {
      return this.deleteFollowingEvents(tenantId, eventId, opts.recurringEventId);
    }

    const scope = opts?.editScope === "series" ? "series" : "instance";
    const targetId = resolveCalendarEventId(eventId, opts?.recurringEventId, scope);
    const corsair = getCorsair().withTenant(tenantId);
    await corsair.googlecalendar.api.events.delete({
      calendarId: "primary",
      id: targetId,
      sendUpdates: "all",
    });

    return { success: true as const };
  }

  async checkFreeBusy(
    tenantId: string,
    input: { startDateTime: string; endDateTime: string; timeZone?: string },
  ) {
    try {
      const status = await this.getConnectionStatus(tenantId);
      if (status.googlecalendar !== "connected") {
        return { conflicts: [], unavailable: true as const };
      }

      const corsair = getCorsair().withTenant(tenantId);

      // Attempt to use the real Google FreeBusy API first.
      try {
        const freeBusyResp = await (corsair.googlecalendar.api as {
          freebusy?: {
            query: (body: {
              timeMin: string;
              timeMax: string;
              timeZone?: string;
              items: Array<{ id: string }>;
            }) => Promise<{
              calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
            }>;
          };
        }).freebusy?.query({
          timeMin: input.startDateTime,
          timeMax: input.endDateTime,
          timeZone: input.timeZone?.trim() || "UTC",
          items: [{ id: "primary" }],
        });

        if (freeBusyResp?.calendars?.primary) {
          const busySlots = freeBusyResp.calendars.primary.busy ?? [];
          // Convert busy slots to minimal CalendarEvent-like objects for the UI.
          const conflicts: CalendarEvent[] = busySlots.map((slot, i) => ({
            id: `busy-${i}`,
            summary: "Busy",
            start: slot.start,
            end: slot.end,
            allDay: false,
          }));
          return { conflicts };
        }
      } catch {
        // FreeBusy API not available (older Corsair SDK) — fall back to listEvents.
      }

      // Fallback: list events and filter overlapping ones.
      const result = await this.listEvents(tenantId, {
        timeMin: input.startDateTime,
        timeMax: input.endDateTime,
        maxResults: 10,
        timeZone: input.timeZone,
      });

      return { conflicts: result.events.filter((e: CalendarEvent) => e.status !== "cancelled") };
    } catch {
      return { conflicts: [], unavailable: true as const };
    }
  }

  async respondToEvent(
    tenantId: string,
    eventId: string,
    response: "accepted" | "declined" | "tentative",
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const existing = await corsair.googlecalendar.api.events.get({
      calendarId: "primary",
      id: eventId,
    });

    // Find the self-attendee (the user themselves) and update their response.
    const selfEmail = (existing.attendees ?? []).find((a: { self?: boolean }) => a.self)?.email;
    const updatedAttendees = (existing.attendees ?? []).map((a: { email?: string; self?: boolean; responseStatus?: string; displayName?: string; organizer?: boolean; optional?: boolean }) => {
      if (a.self || (selfEmail && a.email === selfEmail)) {
        return { ...a, responseStatus: response };
      }
      return a;
    });

    const updated = await corsair.googlecalendar.api.events.update({
      calendarId: "primary",
      id: eventId,
      sendUpdates: "all",
      event: {
        summary: existing.summary,
        description: existing.description,
        location: existing.location,
        start: existing.start,
        end: existing.end,
        attendees: updatedAttendees,
      },
    });

    const mapped = mapEvent(updated);
    if (!mapped) throw new Error("Event not found after RSVP update");
    return mapped;
  }

  async disconnect(tenantId: string): Promise<void> {
    const corsair = getCorsair();
    const deleteFn = (corsair.manage as {
      connections?: { delete: (opts: { tenantId: string; provider: string }) => Promise<void> };
    }).connections?.delete;

    if (!deleteFn) {
      throw new Error("Corsair connections API is not available");
    }

    await deleteFn.call(corsair.manage.connections, { tenantId, provider: "googlecalendar" });
  }

  async registerWebhook(tenantId: string, webhookUrl: string): Promise<void> {
    try {
      const status = await this.getConnectionStatus(tenantId);
      if (status.googlecalendar !== "connected") return;

      await this.stopCalendarChannel(tenantId);

      const corsair = getCorsair().withTenant(tenantId);
      const channelId = `thread-calendar-${tenantId}-${Date.now()}`;
      const channelToken = env.CORSAIR_WEBHOOK_SECRET?.trim();

      const watchResp = await (corsair.googlecalendar.api.events as {
        watch?: (opts: {
          calendarId: string;
          channel: { id: string; type: string; address: string; token?: string };
        }) => Promise<{ resourceId?: string; expiration?: string }>;
      }).watch?.({
        calendarId: "primary",
        channel: {
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          ...(channelToken ? { token: channelToken } : {}),
        },
      });

      const expirationMs = watchResp?.expiration ? Number(watchResp.expiration) : undefined;
      await setCalendarChannel(tenantId, {
        channelId,
        resourceId: watchResp?.resourceId,
        expiration: expirationMs && !Number.isNaN(expirationMs) ? new Date(expirationMs) : undefined,
      });

      logger.info("Calendar webhook channel registered", { tenantId, channelId, webhookUrl });
    } catch (error) {
      logger.warn("registerWebhook failed (best-effort)", {
        tenantId,
        webhookUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async stopCalendarChannel(tenantId: string) {
    const existing = await getCalendarChannel(tenantId);
    if (!existing?.channelId) return;

    try {
      const corsair = getCorsair().withTenant(tenantId);
      await (corsair.googlecalendar.api as {
        channels?: { stop: (body: { id: string; resourceId: string }) => Promise<unknown> };
      }).channels?.stop?.({
        id: existing.channelId,
        resourceId: existing.resourceId ?? "",
      });
    } catch (error) {
      logger.warn("Calendar channel stop failed (continuing renewal)", {
        tenantId,
        channelId: existing.channelId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await clearCalendarChannel(tenantId);
    }
  }
}
