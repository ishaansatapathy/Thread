export type InboxConnectionState =
  | "connected"
  | "missing_credentials"
  | "not_connected"
  | "not_configured";

export type InboxConnectionStatus = {
  gmail: InboxConnectionState;
};

export type InboxMessage = {
  id: string;
  from?: string;
  to?: string;
  date?: string;
  body: string;
  snippet: string;
};

export type InboxThread = {
  id: string;
  snippet: string;
  historyId?: string;
  subject?: string;
  from?: string;
  fromName?: string;
  to?: string;
  date?: string;
  body?: string;
  messageId?: string;
  messages?: InboxMessage[];
  suggestedReplyTo?: string;
  messageCount?: number;
  unread?: boolean;
};

export type InboxDraft = {
  id: string;
  messageId?: string;
  threadId?: string;
  subject?: string;
  to?: string;
  snippet: string;
  updatedAt?: string;
};

export type ListThreadsOptions = {
  maxResults?: number;
  pageToken?: string;
  /** Gmail search query (e.g. `from:foo subject:bar`). When omitted, lists INBOX. */
  query?: string;
};

export interface InboxService {
  isConfigured(): boolean;
  getConnectionStatus(tenantId: string): Promise<InboxConnectionStatus>;
  listThreads(
    tenantId: string,
    opts?: ListThreadsOptions,
  ): Promise<{ threads: InboxThread[]; nextPageToken?: string }>;
  listDrafts(
    tenantId: string,
    opts?: { maxResults?: number; pageToken?: string },
  ): Promise<{ drafts: InboxDraft[]; nextPageToken?: string }>;
  getThread(
    tenantId: string,
    threadId: string,
    opts?: { userEmail?: string },
  ): Promise<InboxThread | null>;
  sendMessage(
    tenantId: string,
    input: { to: string; subject: string; body: string; threadId?: string },
  ): Promise<{ id?: string; threadId?: string }>;
  createDraft(
    tenantId: string,
    input: { to: string; subject: string; body: string; threadId?: string },
  ): Promise<{ id?: string }>;
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
