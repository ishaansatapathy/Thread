import type { InboxService } from "@repo/services/inbox";

/**
 * Wraps the real inbox service so Playwright can exercise compose → queue → approve
 * without live Gmail OAuth. Enabled when THREAD_E2E_MOCK_GMAIL=true (CI / local E2E).
 */
export function createE2eMockInboxService(inner: InboxService): InboxService {
  return {
    ...inner,
    async getConnectionStatus(tenantId) {
      return { gmail: "connected" as const };
    },
    async sendMessage(tenantId, input) {
      return {
        id: `e2e-msg-${Date.now()}`,
        threadId: input.threadId ?? `e2e-thread-${Date.now()}`,
      };
    },
    async createDraft(tenantId, input) {
      return { id: `e2e-draft-${Date.now()}` };
    },
  };
}
