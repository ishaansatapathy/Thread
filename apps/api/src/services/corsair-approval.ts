import { env } from "../env";

/** Used by createCorsair approval.formatAsyncMessage — keep free of getCorsair() to avoid circular imports. */
export function formatCorsairApprovalMessage(opts: {
  token: string;
  plugin: string;
  endpoint: string;
}) {
  void opts.plugin;
  void opts.endpoint;
  return `Action requires approval. Visit ${env.CLIENT_URL}/corsair/approve/${opts.token} to approve or deny, then retry.`;
}
