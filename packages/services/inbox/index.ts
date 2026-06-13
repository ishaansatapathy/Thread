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
  bodyHtml?: string;
  snippet: string;
  attachments?: Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }>;
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
  /** When true, bypass cache short-circuit and re-fetch metadata from Gmail. */
  refresh?: boolean;
};

/** Default inbox page size — initial load and each "load more" chunk. */
export const INBOX_PAGE_SIZE = 15;

export type ListThreadsResult = {
  threads: InboxThread[];
  nextPageToken?: string;
  /** True when rows were served from local cache and a live refresh may still be in flight. */
  stale?: boolean;
};

export interface InboxService {
  isConfigured(): boolean;
  getConnectionStatus(tenantId: string): Promise<InboxConnectionStatus>;
  listThreads(
    tenantId: string,
    opts?: ListThreadsOptions,
  ): Promise<ListThreadsResult>;
  /** Postgres-only thread list for instant inbox paint (no Gmail calls). */
  listCachedThreads(
    tenantId: string,
    opts?: { limit?: number; query?: string },
  ): Promise<{ threads: InboxThread[] }>;
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
  /**
   * Remove the UNREAD label from a Gmail thread.
   * Best-effort: implementations must not throw on failure.
   */
  markThreadRead(tenantId: string, threadId: string): Promise<void>;
  /**
   * Move a thread to Trash by removing INBOX label and adding TRASH label.
   * Best-effort: implementations must not throw on failure.
   */
  archiveThread(tenantId: string, threadId: string): Promise<void>;
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
