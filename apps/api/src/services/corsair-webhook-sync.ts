/**
 * Runtime hooks for Corsair plugin webhookHooks — registered after services boot.
 */
type TenantSyncHandler = (tenantId: string) => void;

let onGmailMessageChanged: TenantSyncHandler | null = null;
let onCalendarEventChanged: TenantSyncHandler | null = null;

export function registerCorsairWebhookSync(handlers: {
  onGmailMessageChanged?: TenantSyncHandler;
  onCalendarEventChanged?: TenantSyncHandler;
}) {
  if (handlers.onGmailMessageChanged) onGmailMessageChanged = handlers.onGmailMessageChanged;
  if (handlers.onCalendarEventChanged) onCalendarEventChanged = handlers.onCalendarEventChanged;
}

function tenantIdFromCtx(ctx: unknown): string | null {
  if (!ctx || typeof ctx !== "object") return null;
  const id = (ctx as { tenantId?: unknown }).tenantId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function buildGmailWebhookHooks() {
  return {
    messageChanged: {
      after(ctx: unknown) {
        const tenantId = tenantIdFromCtx(ctx);
        if (tenantId) void onGmailMessageChanged?.(tenantId);
      },
    },
  };
}

export function buildGoogleCalendarWebhookHooks() {
  return {
    onEventChanged: {
      after(ctx: unknown) {
        const tenantId = tenantIdFromCtx(ctx);
        if (tenantId) void onCalendarEventChanged?.(tenantId);
      },
    },
  };
}
