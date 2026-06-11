import { logger } from "@repo/logger";
import { getGoogleOAuthConfig } from "@repo/services/env";
import type { InboxConnectionStatus, InboxService, InboxThread } from "@repo/services/inbox";

import { getCorsair, getCorsairGmailRedirectUri, isCorsairConfigured } from "../corsair";
import { getCorsairOAuthModule } from "../corsair-imports";

async function ensureTenant(tenantId: string) {
  const corsair = getCorsair();
  try {
    await corsair.manage.tenants.get(tenantId);
  } catch {
    await corsair.manage.tenants.create({ id: tenantId });
  }
}

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
      await ensureTenant(tenantId);
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

    await ensureTenant(tenantId);
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

  async getThread(tenantId: string, threadId: string): Promise<InboxThread | null> {
    if (!this.isConfigured()) return null;

    const status = await this.getConnectionStatus(tenantId);
    if (status.gmail !== "connected") return null;

    const corsair = getCorsair().withTenant(tenantId);
    const thread = await corsair.gmail.api.threads.get({
      id: threadId,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });

    if (!thread.id) return null;

    const headers = thread.messages?.[0]?.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((entry: { name?: string; value?: string }) => entry.name?.toLowerCase() === name.toLowerCase())?.value;

    return {
      id: thread.id,
      snippet: thread.snippet ?? "",
      historyId: thread.historyId,
      subject: header("Subject"),
      from: header("From"),
      to: header("To"),
      date: header("Date"),
    };
  }
}
