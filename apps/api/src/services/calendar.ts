import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import type {
  CalendarConnectionStatus,
  CalendarEvent,
  CalendarService,
} from "@repo/services/calendar";

import {
  getCorsair,
  getCorsairCalendarRedirectUri,
  isCorsairConfigured,
} from "../corsair";
import { getCorsairOAuthModule } from "../corsair-imports";
import { ensureCorsairTenant } from "./corsair-tenant";

function mapEvent(event: {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}): CalendarEvent | null {
  if (!event.id) return null;
  return {
    id: event.id,
    summary: event.summary?.trim() || "Untitled event",
    description: event.description,
    location: event.location,
    start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date,
    htmlLink: event.htmlLink,
    status: event.status,
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

  async listEvents(
    tenantId: string,
    opts: { timeMin: string; timeMax: string; maxResults?: number; timeZone?: string },
  ) {
    if (!this.isConfigured()) return { events: [] };

    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      return { events: [] };
    }

    const corsair = getCorsair().withTenant(tenantId);
    const result = await corsair.googlecalendar.api.events.getMany({
      calendarId: "primary",
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      timeZone: opts.timeZone?.trim() || undefined,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: opts.maxResults ?? 50,
    });

    const events = (result.items ?? [])
      .map(mapEvent)
      .filter((event: CalendarEvent | null): event is CalendarEvent => Boolean(event));

    return { events };
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
    },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    const timeZone = input.timeZone?.trim() || "UTC";
    const corsair = getCorsair().withTenant(tenantId);
    const created = await corsair.googlecalendar.api.events.create({
      calendarId: "primary",
      sendUpdates: "all",
      event: {
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: { dateTime: input.startDateTime, timeZone },
        end: { dateTime: input.endDateTime, timeZone },
        attendees: input.attendeeEmails?.map((email) => ({ email })),
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

  async updateEventTimes(
    tenantId: string,
    eventId: string,
    input: { startDateTime: string; endDateTime: string; timeZone?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    const timeZone = input.timeZone?.trim() || "UTC";
    const corsair = getCorsair().withTenant(tenantId);
    const updated = await corsair.googlecalendar.api.events.update({
      calendarId: "primary",
      id: eventId,
      sendUpdates: "all",
      event: {
        start: { dateTime: input.startDateTime, timeZone },
        end: { dateTime: input.endDateTime, timeZone },
      },
    });

    const mapped = mapEvent(updated);
    if (!mapped) {
      throw new Error("Calendar event was updated but returned no id");
    }
    return mapped;
  }

  async deleteEvent(tenantId: string, eventId: string) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.googlecalendar !== "connected") {
      throw new Error("Google Calendar is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    await corsair.googlecalendar.api.events.delete({
      calendarId: "primary",
      id: eventId,
      sendUpdates: "all",
    });

    return { success: true as const };
  }
}
