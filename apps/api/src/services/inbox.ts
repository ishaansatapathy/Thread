import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import type { InboxConnectionStatus, InboxService, InboxThread } from "@repo/services/inbox";

import { getCorsair, getCorsairGmailRedirectUri, isCorsairConfigured } from "../corsair";
import { getCorsairOAuthModule } from "../corsair-imports";
import {
  buildRawEmail,
  getHeader,
  normalizeSubject,
  parseEmailAddress,
  parseGmailMessage,
  suggestReplyTo,
} from "../utils/gmail-message";
import { ensureCorsairTenant } from "./corsair-tenant";

export class CorsairInboxService implements InboxService {
  isConfigured() {
    if (!isCorsairConfigured()) return false;
    const google = getGoogleOAuthConfig();
    return Boolean(google.clientId && google.clientSecret);
  }

  async getConnectionStatus(tenantId: string): Promise<InboxConnectionStatus> {
    if (!this.isConfigured()) {
      return { gmail: "not_configured" };
    }

    try {
      await ensureCorsairTenant(tenantId);
      const corsair = getCorsair();
      const status = await corsair.manage.connectionStatus.get({ tenantId });
      return { gmail: status.gmail ?? "not_connected" };
    } catch (error) {
      logger.warn("Inbox connection status failed", {
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { gmail: "not_connected" };
    }
  }

  async getGmailConnectUrl(tenantId: string, returnTo = "/inbox") {
    if (!this.isConfigured()) {
      throw new Error("Gmail integration is not configured on the server");
    }

    await ensureCorsairTenant(tenantId);
    const corsair = getCorsair();
    const redirectUri = getCorsairGmailRedirectUri();
    const { generateOAuthUrl } = getCorsairOAuthModule();
    const { url, state } = await generateOAuthUrl(corsair, "gmail", {
      tenantId,
      redirectUri,
    });

    return { url, state, returnTo, redirectUri };
  }

  async completeGmailOAuth(input: { code: string; state: string }) {
    const corsair = getCorsair();
    const redirectUri = getCorsairGmailRedirectUri();
    const { processOAuthCallback } = getCorsairOAuthModule();
    return processOAuthCallback(corsair, {
      code: input.code,
      state: input.state,
      redirectUri,
    });
  }

  async listThreads(
    tenantId: string,
    opts?: { maxResults?: number; pageToken?: string },
  ): Promise<{ threads: InboxThread[]; nextPageToken?: string }> {
    if (!this.isConfigured()) {
      return { threads: [] };
    }

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      return { threads: [] };
    }

    const corsair = getCorsair().withTenant(tenantId);
    const result = await corsair.gmail.api.threads.list({
      maxResults: opts?.maxResults ?? 25,
      pageToken: opts?.pageToken,
      labelIds: ["INBOX"],
    });

    const threads: InboxThread[] = (result.threads ?? []).map((thread: { id?: string; snippet?: string; historyId?: string }) => ({
      id: thread.id ?? "",
      snippet: thread.snippet ?? "",
      historyId: thread.historyId,
    }));

    return {
      threads: threads.filter((thread) => thread.id),
      nextPageToken: result.nextPageToken,
    };
  }

  async getThread(
    tenantId: string,
    threadId: string,
    opts?: { userEmail?: string },
  ): Promise<InboxThread | null> {
    if (!this.isConfigured()) return null;

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") return null;

    const corsair = getCorsair().withTenant(tenantId);
    const thread = await corsair.gmail.api.threads.get({
      id: threadId,
      format: "full",
    });

    if (!thread.id) return null;

    const messages = (thread.messages ?? [])
      .map((message) => parseGmailMessage(message))
      .filter((message): message is NonNullable<typeof message> => Boolean(message));

    if (messages.length === 0) return null;

    const firstHeaders = thread.messages?.[0]?.payload?.headers ?? [];
    const subject = normalizeSubject(getHeader(firstHeaders, "Subject"));
    const last = messages[messages.length - 1]!;

    return {
      id: thread.id,
      snippet: thread.snippet ?? last.snippet,
      historyId: thread.historyId,
      subject,
      from: last.from,
      to: last.to,
      date: last.date,
      body: last.body,
      messageId: last.id,
      messages,
      messageCount: messages.length,
      suggestedReplyTo: suggestReplyTo(messages, opts?.userEmail),
    };
  }

  async sendMessage(
    tenantId: string,
    input: { to: string; subject: string; body: string; threadId?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const raw = buildRawEmail(input);
    const result = await corsair.gmail.api.messages.send({
      raw,
      threadId: input.threadId,
    });

    return { id: result.id, threadId: result.threadId ?? input.threadId };
  }

  async createDraft(
    tenantId: string,
    input: { to: string; subject: string; body: string; threadId?: string },
  ) {
    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") {
      throw new Error("Gmail is not connected");
    }

    const corsair = getCorsair().withTenant(tenantId);
    const raw = buildRawEmail(input);
    const result = await corsair.gmail.api.drafts.create({
      draft: {
        message: {
          raw,
          threadId: input.threadId,
        },
      },
    });

    return { id: result.id };
  }
}
