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
  /** Gmail label IDs on the thread (e.g. ["STARRED", "IMPORTANT", "INBOX"]). */
  labelIds?: string[];
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
  getDraft(
    tenantId: string,
    draftId: string,
  ): Promise<{ id: string; to?: string; subject?: string; body: string; threadId?: string } | null>;
  getThread(
    tenantId: string,
    threadId: string,
    opts?: { userEmail?: string },
  ): Promise<InboxThread | null>;
  sendMessage(
    tenantId: string,
    input: {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
      cc?: string;
      bcc?: string;
      attachments?: Array<{ filename: string; mimeType: string; contentBase64: string }>;
    },
  ): Promise<{ id?: string; threadId?: string }>;
  createDraft(
    tenantId: string,
    input: {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
      cc?: string;
      bcc?: string;
      attachments?: Array<{ filename: string; mimeType: string; contentBase64: string }>;
    },
  ): Promise<{ id?: string }>;
  /**
   * Remove the UNREAD label from a Gmail thread.
   * Throws if Gmail is not connected or the API call fails.
   */
  markThreadRead(tenantId: string, threadId: string): Promise<void>;
  /**
   * Add the UNREAD label to a Gmail thread.
   * Throws if Gmail is not connected or the API call fails.
   */
  markThreadUnread(tenantId: string, threadId: string): Promise<void>;
  /**
   * Archive a thread by removing the INBOX label.
   * Throws if Gmail is not connected or the API call fails.
   */
  archiveThread(tenantId: string, threadId: string): Promise<void>;
  /** List all user-defined and system Gmail labels. */
  listLabels(tenantId: string): Promise<Array<{ id: string; name: string; type?: string }>>;
  /** Apply a label to a thread. Throws on failure. */
  applyLabel(tenantId: string, threadId: string, labelId: string): Promise<void>;
  /** Remove a label from a thread. Throws on failure. */
  removeLabel(tenantId: string, threadId: string, labelId: string): Promise<void>;
  /** Star a thread via Corsair Gmail (STARRED label). */
  starThread(tenantId: string, threadId: string): Promise<void>;
  /** Unstar a thread via Corsair Gmail. */
  unstarThread(tenantId: string, threadId: string): Promise<void>;
  /** Mark thread as important via Corsair Gmail (IMPORTANT label). */
  markImportant(tenantId: string, threadId: string): Promise<void>;
  /** Remove important flag via Corsair Gmail. */
  markNotImportant(tenantId: string, threadId: string): Promise<void>;
  /** Move a Gmail thread to trash via Corsair. */
  trashThread(tenantId: string, threadId: string): Promise<void>;
  /** Delete a Gmail draft by id via Corsair. */
  deleteDraft(tenantId: string, draftId: string): Promise<void>;
  /**
   * Ensure a Gmail label exists (create it via Corsair if missing).
   * Returns the label ID. Results are cached per-process per tenant+name.
   */
  ensureLabel(
    tenantId: string,
    name: string,
    opts?: { backgroundColor?: string; textColor?: string },
  ): Promise<string>;
  /**
   * Apply AI-derived Gmail labels (Corsair/Critical, Corsair/High Priority, etc.)
   * to a batch of threads based on their urgency and category scores.
   * Creates labels if missing. Fire-and-forget safe — non-fatal on individual failures.
   */
  autoLabelThreads(
    tenantId: string,
    items: Array<{
      id: string;
      urgency: "critical" | "high" | "medium" | "low" | "noise";
      category: "reply_needed" | "deadline" | "meeting" | "billing" | "fyi" | "promo";
    }>,
  ): Promise<void>;
  /**
   * Register Gmail Pub/Sub push notifications (users.watch).
   * Best-effort when CORSAIR_GMAIL_TOPIC_ID is unset; throws on API failure.
   */
  registerGmailWatch(tenantId: string): Promise<void>;
  /**
   * Revoke Gmail OAuth credentials for a tenant (disconnect Gmail).
   * Throws if the disconnect API call fails.
   */
  disconnect(tenantId: string): Promise<void>;
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
