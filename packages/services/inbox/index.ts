export type InboxConnectionState =
  | "connected"
  | "missing_credentials"
  | "not_connected"
  | "not_configured";

export type InboxConnectionStatus = {
  gmail: InboxConnectionState;
};

export type InboxThread = {
  id: string;
  snippet: string;
  historyId?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
};

export interface InboxService {
  isConfigured(): boolean;
  getConnectionStatus(tenantId: string): Promise<InboxConnectionStatus>;
  listThreads(
    tenantId: string,
    opts?: { maxResults?: number; pageToken?: string },
  ): Promise<{ threads: InboxThread[]; nextPageToken?: string }>;
  getThread(tenantId: string, threadId: string): Promise<InboxThread | null>;
}

let inboxService: InboxService | null = null;

export function registerInboxService(service: InboxService) {
  inboxService = service;
}

export function getInboxService(): InboxService {
  if (!inboxService) {
    throw new Error("Inbox service is not registered");
  }
  return inboxService;
}

export function tryGetInboxService(): InboxService | null {
  return inboxService;
}
