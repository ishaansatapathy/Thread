"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  Sparkles,
  XCircle,
} from "lucide-react";

import { trpc } from "~/trpc/client";

const KIND_LABEL: Record<string, string> = {
  email_send: "Send email",
  email_draft: "Save draft",
  calendar_invite: "Calendar invite",
  meeting_bundle: "Meeting + email",
};

function kindIcon(kind: string) {
  if (kind.includes("calendar") || kind === "meeting_bundle") return Calendar;
  return Mail;
}

export default function QueuePage() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const utils = trpc.useUtils();

  const itemsQuery = trpc.queue.list.useQuery({ status: tab === "pending" ? "pending" : "all" });

  const approve = trpc.queue.approve.useMutation({
    onSuccess: async () => {
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      await utils.inbox.listThreads.invalidate();
      await utils.calendar.listEvents.invalidate();
      toast.success("Approved and sent through Corsair");
    },
    onError: (error) => toast.error(error.message),
  });

  const dismiss = trpc.queue.dismiss.useMutation({
    onSuccess: async () => {
      await utils.queue.list.invalidate();
      await utils.queue.pendingCount.invalidate();
      toast.success("Removed from queue");
    },
    onError: (error) => toast.error(error.message),
  });

  const items = itemsQuery.data?.items ?? [];
  const pending = items.filter((item) => item.status === "pending");

  return (
    <div className="thread-queue-page">
      <div className="thread-queue-hero">
        <div>
          <h2>Approval queue</h2>
          <p>
            Replies, drafts, and calendar invites wait here. Nothing sends until you approve — human in
            the loop, powered by Corsair.
          </p>
        </div>
        <Link href="/inbox" className="thread-btn-ghost" style={{ fontSize: 13, padding: "8px 14px" }}>
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

      {itemsQuery.isLoading ? (
        <div className="thread-empty-inbox" style={{ marginTop: 24 }}>
          <Loader2 size={18} className="thread-spin" />
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--thread-dim)" }}>Loading queue…</p>
        </div>
      ) : tab === "pending" && pending.length === 0 ? (
        <div className="thread-app-empty" style={{ marginTop: 24 }}>
          <div className="thread-app-empty-icon">
            <Sparkles size={24} />
          </div>
          <div>
            <h3>Nothing waiting for approval</h3>
            <p>Queue a reply or meeting from Inbox — it will show up here before anything sends.</p>
          </div>
          <Link href="/inbox" className="thread-btn-accent" style={{ fontSize: 13, padding: "10px 18px" }}>
            Open inbox
          </Link>
        </div>
      ) : (
        <div className="thread-queue-list">
          {items.map((item) => {
            const Icon = kindIcon(item.kind);
            const isPending = item.status === "pending";
            return (
              <article key={item.id} className="thread-queue-card" data-status={item.status}>
                <div className="thread-queue-card-head">
                  <span className="thread-queue-card-icon">
                    <Icon size={16} />
                  </span>
                  <div className="thread-queue-card-meta">
                    <h3>{item.title}</h3>
                    <div className="thread-queue-card-tags">
                      <span className="thread-mono-tag">{KIND_LABEL[item.kind] ?? item.kind}</span>
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
                {item.errorMessage ? (
                  <p className="thread-queue-card-error">{item.errorMessage}</p>
                ) : null}

                {isPending ? (
                  <div className="thread-queue-card-actions">
                    <button
                      type="button"
                      className="thread-btn-ghost"
                      disabled={dismiss.isPending || approve.isPending}
                      onClick={() => dismiss.mutate({ id: item.id })}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="thread-btn-accent"
                      disabled={approve.isPending || dismiss.isPending}
                      onClick={() => approve.mutate({ id: item.id })}
                    >
                      {approve.isPending ? "Sending…" : "Approve & send"}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
