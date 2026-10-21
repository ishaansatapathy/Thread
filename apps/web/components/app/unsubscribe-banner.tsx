"use client";

import { useState } from "react";
import { Archive, CheckCircle2, ExternalLink, Loader2, MailX } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "~/trpc/client";

/**
 * Mailing-list banner. Uses the List-Unsubscribe header for one-click (RFC 8058) or
 * mailto unsubscribes so the user never has to open the sender's website; falls back
 * to the link found in the body when the header offers nothing automatic.
 */
export function UnsubscribeBanner({
  messageId,
  bodyLinkUrl,
  onArchive,
}: {
  messageId?: string;
  bodyLinkUrl?: string;
  onArchive: () => void;
}) {
  const [doneDetail, setDoneDetail] = useState<string | null>(null);
  const info = trpc.inbox.unsubscribeInfo.useQuery(
    { messageId: messageId ?? "" },
    { enabled: Boolean(messageId), staleTime: 5 * 60_000, retry: false },
  );
  const unsubscribe = trpc.inbox.unsubscribe.useMutation({
    onSuccess: (result) => {
      if (result.done) {
        setDoneDetail(result.detail);
        toast.success(result.detail);
        return;
      }
      toast.message(result.detail);
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
    },
    onError: (error) => toast.error(error.message),
  });

  const method = info.data?.method ?? "none";
  const automatic = method === "one_click" || method === "mailto";
  const websiteUrl = info.data?.url ?? bodyLinkUrl;

  if (!automatic && !websiteUrl) return null;

  if (doneDetail) {
    return (
      <div className="thread-unsub-banner" data-done="true">
        <span className="thread-unsub-banner-label">
          <CheckCircle2 size={12} />
          {doneDetail}
        </span>
        <button type="button" className="thread-unsub-archive" onClick={onArchive}>
          <Archive size={11} />
          Archive
        </button>
      </div>
    );
  }

  return (
    <div className="thread-unsub-banner">
      <span className="thread-unsub-banner-label">
        Looks like a mailing list
        {automatic ? <span className="thread-unsub-chip">One click · no website</span> : null}
      </span>
      {automatic ? (
        <button
          type="button"
          className="thread-unsub-btn"
          disabled={unsubscribe.isPending || !messageId}
          onClick={() => messageId && unsubscribe.mutate({ messageId })}
          title={
            method === "mailto" && info.data?.mailtoAddress
              ? `Sends an unsubscribe email to ${info.data.mailtoAddress}`
              : "Unsubscribes directly with the sender"
          }
        >
          {unsubscribe.isPending ? <Loader2 size={11} className="thread-spin" /> : <MailX size={11} />}
          Unsubscribe
        </button>
      ) : (
        <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="thread-unsub-btn">
          <ExternalLink size={11} />
          Unsubscribe
        </a>
      )}
      <button type="button" className="thread-unsub-archive" onClick={onArchive}>
        <Archive size={11} />
        Archive
      </button>
    </div>
  );
}
