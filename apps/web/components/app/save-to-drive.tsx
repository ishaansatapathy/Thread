"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "~/trpc/client";

type Attachment = { attachmentId?: string; filename: string; mimeType?: string };

/** Queues a Drive save for a message's attachments; runs only after approval in Queue. */
export function SaveToDrive({
  messageId,
  threadId,
  attachments,
  suggestedFolder,
}: {
  messageId: string;
  threadId?: string;
  attachments: Attachment[];
  suggestedFolder?: string;
}) {
  const pathname = usePathname();
  const utils = trpc.useUtils();
  const status = trpc.workspace.connectionStatus.useQuery({}, { staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState(suggestedFolder ?? "");

  const saveable = attachments.filter((a): a is Attachment & { attachmentId: string } => Boolean(a.attachmentId));
  const queueSave = trpc.workspace.queueSaveAttachments.useMutation({
    onSuccess: async () => {
      setOpen(false);
      await utils.queue.pendingCount.invalidate();
      await utils.queue.list.invalidate();
      toast.success("Drive save queued — approve it in Queue");
    },
    onError: (error) => toast.error(error.message),
  });

  if (saveable.length === 0 || status.isLoading) return null;

  if (status.data?.googledrive !== "connected") {
    return (
      <a
        className="thread-inbox-drive-btn"
        href={`/api-connect/workspace/googledrive?state=${encodeURIComponent(pathname || "/inbox")}`}
      >
        <HardDrive size={12} />
        Connect Drive to save
      </a>
    );
  }

  if (!open) {
    return (
      <button type="button" className="thread-inbox-drive-btn" onClick={() => setOpen(true)}>
        <HardDrive size={12} />
        {saveable.length === 1 ? "Save to Drive" : `Save all ${saveable.length} to Drive`}
      </button>
    );
  }

  return (
    <form
      className="thread-inbox-drive-form"
      onSubmit={(e) => {
        e.preventDefault();
        queueSave.mutate({
          messageId,
          threadId,
          folderName: folder.trim() || undefined,
          attachments: saveable.slice(0, 10).map((a) => ({
            attachmentId: a.attachmentId,
            filename: a.filename,
            mimeType: a.mimeType || "application/octet-stream",
          })),
        });
      }}
    >
      <HardDrive size={12} />
      <input
        autoFocus
        value={folder}
        maxLength={200}
        onChange={(e) => setFolder(e.target.value)}
        placeholder="Folder name (optional)"
        aria-label="Drive folder name"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <button type="submit" className="thread-inbox-drive-btn thread-inbox-drive-btn--primary" disabled={queueSave.isPending}>
        {queueSave.isPending ? <Loader2 size={12} className="thread-spin" /> : null}
        Queue save
      </button>
      <button type="button" className="thread-inbox-drive-btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
