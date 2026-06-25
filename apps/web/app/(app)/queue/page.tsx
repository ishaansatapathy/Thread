"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  Calendar,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import { SkeletonList } from "~/components/app/skeleton-list";
import { QueryErrorState } from "~/components/app/query-error-state";
import { dismissBriefThreadFromQueueItem } from "~/lib/brief-dismissals";
import { useQueueIntegrationGate } from "~/components/app/connect-required-modal";
import {
  isoToLocalDateTimeInput,
  localDateTimeRangeToPayload,
  validateLocalDateTimeRange,
} from "~/lib/calendar-datetime";

const KIND_LABEL: Record<string, string> = {
  email_send: "Send email",
  email_draft: "Save draft",
  draft_send: "Send draft",
  calendar_invite: "Calendar invite",
  meeting_bundle: "Meeting + email",
  calendar_archive: "Reschedule event",
  calendar_delete: "Delete event",
  calendar_update: "Update event details",
};

type ArchiveConfirmState = {
  itemId: string;
  title: string;
  startAt: string;
  endAt: string;
};

function kindIcon(kind: string) {
  if (kind === "calendar_delete") return Trash2;
  if (kind === "calendar_update") return Sparkles;
  if (kind === "calendar_archive") return Archive;
  if (kind.includes("calendar") || kind === "meeting_bundle") return Calendar;
  return Mail;
}

function kindLabel(kind: string, payload: Record<string, unknown>) {
  if (kind === "calendar_delete" && payload.cancelWithNotify === true) return "Cancel event";
  return KIND_LABEL[kind] ?? kind;
}

function readArchivePayload(payload: Record<string, unknown>) {
  return {
    startDateTime: String(payload.startDateTime ?? ""),
    endDateTime: String(payload.endDateTime ?? ""),
    timeZone: payload.timeZone ? String(payload.timeZone) : undefined,
  };
}

export default function QueuePage() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [archiveConfirm, setArchiveConfirm] = useState<ArchiveConfirmState | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"approve" | "dismiss" | null>(null);
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery({});
  const { checkBeforeApprove, showRequirementFromError, modal: connectModal } =
    useQueueIntegrationGate(meQuery.data?.email);

  const itemsQuery = trpc.queue.list.useQuery({ status: tab === "pending" ? "pending" : "all" });

  const approve = trpc.queue.approve.useMutation({
    onMutate: async ({ id }) => {
      setActiveItemId(id);
      setActiveAction("approve");
      // Optimistic update: mark item as approved immediately
      await utils.queue.list.cancel();
      const prev = utils.queue.list.getData({ status: tab === "pending" ? "pending" : "all" });
      utils.queue.list.setData({ status: tab === "pending" ? "pending" : "all" }, (old) => {
        if (!old) return old;
        if (tab === "pending") {
          return {
            ...old,
            items: old.items.filter((item) => item.id !== id),
          };
        }
        return {
          ...old,
          items: old.items.map((item) =>
            item.id === id ? { ...item, status: "approved" as const } : item,
          ),
        };
      });
      return { prev };
    },
    onSuccess: async (data) => {
      dismissBriefThreadFromQueueItem(data);
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      await utils.inbox.listThreads.invalidate();
      await utils.calendar.listEvents.invalidate();
      await utils.calendar.listEvents.refetch();
      await utils.ai.dailyBrief.invalidate();
      setArchiveConfirm(null);

      if (data.kind === "calendar_archive") {
        toast.success("Approved — event rescheduled on your calendar");
      } else if (data.kind === "calendar_delete") {
        toast.success("Approved — event deleted from Google Calendar");
      } else if (data.kind === "meeting_bundle" || data.kind === "calendar_invite") {
        toast.success("Approved — calendar invite sent");
      } else if (data.kind === "email_draft") {
        toast.success("Draft saved to Gmail");
      } else {
        toast.success("Approved and sent");
      }
    },
    onError: (error, _vars, ctx) => {
      handleQueueMutationError(error, ctx);
    },
    onSettled: () => {
      setActiveItemId(null);
      setActiveAction(null);
    },
  });

  const dismiss = trpc.queue.dismiss.useMutation({
    onMutate: async ({ id }) => {
      setActiveItemId(id);
      setActiveAction("dismiss");
      await utils.queue.list.cancel();
      const prev = utils.queue.list.getData({ status: tab === "pending" ? "pending" : "all" });
      const dismissedItem = prev?.items.find((item) => item.id === id);
      utils.queue.list.setData({ status: tab === "pending" ? "pending" : "all" }, (old) => {
        if (!old) return old;
        if (tab === "pending") {
          return {
            ...old,
            items: old.items.filter((item) => item.id !== id),
          };
        }
        return {
          ...old,
          items: old.items.map((item) =>
            item.id === id ? { ...item, status: "dismissed" as const } : item,
          ),
        };
      });
      return { prev, dismissedItem };
    },
    onSuccess: async (_data, _vars, ctx) => {
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      if (ctx?.dismissedItem?.kind === "calendar_delete") {
        toast.success("Delete request cancelled — event stays on your calendar");
      } else {
        toast.success("Removed from queue");
      }
    },
    onError: (error, _vars, ctx) => {
      handleQueueMutationError(error, ctx);
    },
    onSettled: () => {
      setActiveItemId(null);
      setActiveAction(null);
    },
  });

  const items = itemsQuery.data?.items ?? [];
  const pending = items.filter((item) => item.status === "pending" || item.status === "processing");
  const anyBusy = activeItemId !== null || approve.isPending || dismiss.isPending;

  const handleQueueMutationError = (
    error: { message: string },
    ctx?: { prev?: typeof itemsQuery.data },
  ) => {
    const alreadyResolved = /already resolved|not found/i.test(error.message);
    if (alreadyResolved) {
      void utils.queue.list.invalidate();
      void utils.queue.pendingCount.invalidate();
      toast.message("That item was already processed — refreshing queue.");
      return;
    }

    if (showRequirementFromError(error.message)) {
      void utils.queue.list.invalidate();
      void utils.queue.pendingCount.invalidate();
      return;
    }

    if (/PRECONDITION_FAILED|Could not complete|not connected/i.test(error.message)) {
      void utils.queue.list.invalidate();
      void utils.queue.pendingCount.invalidate();
      toast.error(
        error.message.includes("Check your connections")
          ? `${error.message} The item is still in your queue — fix the issue and try again.`
          : error.message,
      );
      return;
    }

    toast.error(error.message);
    if (ctx?.prev) {
      utils.queue.list.setData({ status: tab === "pending" ? "pending" : "all" }, ctx.prev);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.preview ?? "").toLowerCase().includes(q) ||
        kindLabel(item.kind, item.payload).toLowerCase().includes(q),
    );
  }, [items, search]);

  const approveLabel = (item: (typeof items)[number]) => {
    if (activeItemId === item.id && activeAction === "approve") {
      if (item.kind === "calendar_archive") return "Proceeding…";
      if (item.kind === "email_draft") return "Saving…";
      if (item.kind === "draft_send") return "Sending…";
      return "Sending…";
    }
    if (item.kind === "calendar_archive") return "Review dates";
    if (item.kind === "calendar_delete") {
      return item.payload.cancelWithNotify === true ? "Approve cancel" : "Approve delete";
    }
    if (item.kind === "draft_send") return "Approve & send draft";
    return "Approve & send";
  };

  const handleApproveClick = (item: (typeof items)[number]) => {
    if (!checkBeforeApprove(item.kind)) return;
    if (item.kind === "calendar_archive") {
      const archive = readArchivePayload(item.payload);
      setArchiveConfirm({
        itemId: item.id,
        title: item.title,
        startAt: isoToLocalDateTimeInput(archive.startDateTime),
        endAt: isoToLocalDateTimeInput(archive.endDateTime),
      });
      return;
    }
    approve.mutate({ id: item.id });
  };

  // Keyboard shortcut: press A to approve first pending item, D to dismiss it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "a" || event.key === "A") {
        const first = pending[0];
        if (first && !anyBusy) handleApproveClick(first);
      } else if (event.key === "d" || event.key === "D") {
        const first = pending[0];
        if (first && !anyBusy) dismiss.mutate({ id: first.id });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, anyBusy]);

  const archiveDateError = useMemo(() => {
    if (!archiveConfirm) return null;
    const check = validateLocalDateTimeRange(archiveConfirm.startAt, archiveConfirm.endAt);
    return check.valid ? null : check.message;
  }, [archiveConfirm]);

  return (
    <div className="thread-queue-page">
      <div className="thread-queue-hero">
        <div>
          <h2>Approval queue</h2>
          <p>
            Replies, drafts, and calendar actions wait here. Nothing sends until you approve — human
            in the loop, powered by Corsair.
          </p>
        </div>
        <Link
          href="/inbox"
          className="thread-btn-ghost"
          style={{ fontSize: 13, padding: "8px 14px" }}
        >
          Back to inbox
        </Link>
      </div>

      <div className="thread-queue-tabs">
        <button
          type="button"
          className="thread-inbox-tab"
          data-active={tab === "pending"}
          onClick={() => setTab("pending")}
        >
          Pending
        </button>
        <button
          type="button"
          className="thread-inbox-tab"
          data-active={tab === "all"}
          onClick={() => setTab("all")}
        >
          History
        </button>
      </div>

      <div className="thread-queue-search">
        <Search size={14} className="thread-queue-search-icon" />
        <input
          className="thread-set-input"
          placeholder="Filter by title, preview, or type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 30, fontSize: 13 }}
        />
      </div>

      {itemsQuery.isLoading ? (
        <SkeletonList count={6} />
      ) : itemsQuery.isError ? (
        <QueryErrorState
          title="Couldn't load queue"
          message={itemsQuery.error.message}
          onRetry={() => void itemsQuery.refetch()}
          className="thread-app-empty"
          style={{ marginTop: 24 }}
        />
      ) : tab === "pending" && pending.length === 0 ? (
        <div className="thread-app-empty" style={{ marginTop: 24 }}>
          <div className="thread-app-empty-icon">
            <Sparkles size={24} />
          </div>
          <div>
            <h3>Nothing waiting for approval</h3>
            <p>Queue a reply or meeting from Inbox — it will show up here before anything sends.</p>
          </div>
          <Link
            href="/inbox"
            className="thread-btn-accent"
            style={{ fontSize: 13, padding: "10px 18px" }}
          >
            Open inbox
          </Link>
        </div>
      ) : (
        <div className="thread-queue-list">
          {filtered.map((item) => {
            const Icon = kindIcon(item.kind);
            const isPending = item.status === "pending" || item.status === "processing";
            const isProcessing = item.status === "processing";
            const canRetry = item.status === "failed";
            return (
              <article key={item.id} className="thread-queue-card" data-status={item.status}>
                <div className="thread-queue-card-head">
                  <span className="thread-queue-card-icon">
                    <Icon size={16} />
                  </span>
                  <div className="thread-queue-card-meta">
                    <h3>{item.title}</h3>
                    <div className="thread-queue-card-tags">
                      <span className="thread-mono-tag">{kindLabel(item.kind, item.payload)}</span>
                      <span className="thread-queue-card-time">
                        <Clock3 size={12} />
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {!isPending ? (
                    <span className="thread-queue-status" data-status={item.status}>
                      {item.status === "approved" && <CheckCircle2 size={13} />}
                      {item.status === "dismissed" && <XCircle size={13} />}
                      {item.status === "failed" && <XCircle size={13} />}
                      {item.status}
                    </span>
                  ) : null}
                </div>

                {item.preview ? <p className="thread-queue-card-preview">{item.preview}</p> : null}
                {(item.kind === "email_send" || item.kind === "email_draft") &&
                  (item.payload?.cc || item.payload?.bcc) ? (
                  <div className="thread-queue-card-recipients" style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {item.payload.cc ? <span><strong>Cc:</strong> {String(item.payload.cc)}</span> : null}
                    {item.payload.bcc ? <span><strong>Bcc:</strong> {String(item.payload.bcc)}</span> : null}
                  </div>
                ) : null}
                {item.errorMessage ? (
                  <p className="thread-queue-card-error">{item.errorMessage}</p>
                ) : null}

                {isPending || canRetry ? (
                  <div className="thread-queue-card-actions">
                    <button
                      type="button"
                      className="thread-btn-ghost"
                      disabled={anyBusy}
                      onClick={() => dismiss.mutate({ id: item.id })}
                    >
                      {activeItemId === item.id && activeAction === "dismiss" ? "Removing…" : isProcessing ? "Cancel" : "Dismiss"}
                    </button>
                    <button
                      type="button"
                      className="thread-btn-accent"
                      disabled={anyBusy || isProcessing}
                      onClick={() => handleApproveClick(item)}
                    >
                      {isProcessing
                        ? "Processing…"
                        : canRetry
                          ? "Retry"
                          : approveLabel(item)}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {archiveConfirm ? (
        <div
          className="thread-modal-backdrop thread-modal-backdrop--confirm"
          onClick={() => !anyBusy && setArchiveConfirm(null)}
        >
          <div
            className="thread-modal thread-cal-delete-modal thread-cal-confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="thread-modal-head">
              <h3>Confirm dates</h3>
              <button
                type="button"
                className="thread-app-iconbtn"
                disabled={anyBusy}
                onClick={() => setArchiveConfirm(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="thread-cal-event-detail">
              <p className="thread-cal-confirm-title">{archiveConfirm.title}</p>
              <p className="thread-cal-event-detail-copy">
                Confirm or edit the dates below, then proceed. The event stays as a normal calendar
                entry — this step only approves your queued request.
              </p>
              <div className="thread-modal-row">
                <div>
                  <label className="thread-set-label" htmlFor="archive-start">
                    Starts
                  </label>
                  <input
                    id="archive-start"
                    className="thread-set-input"
                    type="datetime-local"
                    value={archiveConfirm.startAt}
                    onChange={(event) =>
                      setArchiveConfirm((current) =>
                        current ? { ...current, startAt: event.target.value } : current,
                      )
                    }
                  />
                </div>
                <div>
                  <label className="thread-set-label" htmlFor="archive-end">
                    Ends
                  </label>
                  <input
                    id="archive-end"
                    className="thread-set-input"
                    type="datetime-local"
                    value={archiveConfirm.endAt}
                    onChange={(event) =>
                      setArchiveConfirm((current) =>
                        current ? { ...current, endAt: event.target.value } : current,
                      )
                    }
                  />
                </div>
              </div>
              {archiveDateError ? (
                <p className="thread-cal-date-error">{archiveDateError}</p>
              ) : null}
            </div>
            <div className="thread-modal-actions">
              <button
                type="button"
                className="thread-btn-ghost"
                disabled={anyBusy}
                onClick={() => setArchiveConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="thread-btn-accent"
                disabled={anyBusy || Boolean(archiveDateError)}
                onClick={() => {
                  if (archiveDateError) {
                    toast.error(archiveDateError);
                    return;
                  }
                  if (!checkBeforeApprove("calendar_archive")) return;
                  try {
                    const archive = localDateTimeRangeToPayload(
                      archiveConfirm.startAt,
                      archiveConfirm.endAt,
                    );
                    approve.mutate({
                      id: archiveConfirm.itemId,
                      archive,
                    });
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Please review your dates");
                  }
                }}
              >
                {activeItemId === archiveConfirm.itemId && activeAction === "approve"
                  ? "Proceeding…"
                  : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {connectModal}
    </div>
  );
}
