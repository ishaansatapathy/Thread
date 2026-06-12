export type CalendarConnectionState =
  | "connected"
  | "missing_credentials"
  | "not_connected"
  | "not_configured";

export type CalendarConnectionStatus = {
  googlecalendar: CalendarConnectionState;
};

export type CalendarEventAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  optional?: boolean;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  htmlLink?: string;
  status?: string;
  /** Set by Google when this instance belongs to a recurring series. */
  recurringEventId?: string;
  isRecurring?: boolean;
  attendees?: CalendarEventAttendee[];
  hangoutLink?: string;
};

export interface CalendarService {
  isConfigured(): boolean;
  getConnectionStatus(tenantId: string): Promise<CalendarConnectionStatus>;
  listEvents(
    tenantId: string,
    opts: {
      timeMin: string;
      timeMax: string;
      maxResults?: number;
      timeZone?: string;
      pageToken?: string;
    },
  ): Promise<{ events: CalendarEvent[]; nextPageToken?: string }>;
  createEvent(
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
  ): Promise<CalendarEvent>;
  cancelEvent(tenantId: string, eventId: string): Promise<{ success: true }>;
  deleteEvent(tenantId: string, eventId: string): Promise<{ success: true }>;
  updateEventTimes(
    tenantId: string,
    eventId: string,
    input: { startDateTime: string; endDateTime: string; timeZone?: string },
  ): Promise<CalendarEvent>;
}

let calendarService: CalendarService | null = null;

export function registerCalendarService(service: CalendarService) {
  calendarService = service;
}

export function getCalendarService(): CalendarService {
  if (!calendarService) {
    throw new Error("Calendar service is not registered");
  }
  return calendarService;
}
