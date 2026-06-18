"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type PermissionRecord = {
  token: string;
  plugin: string;
  endpoint: string;
  status: string;
  tenantId?: string;
  expiresAt?: string;
  args?: unknown;
};

export default function CorsairApprovePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [record, setRecord] = useState<PermissionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    if (!token) return;
    void fetch(`/corsair/permissions/${encodeURIComponent(token)}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        return res.json() as Promise<PermissionRecord>;
      })
      .then(setRecord)
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const act = useCallback(
    async (action: "approve" | "deny") => {
      if (!token) return;
      setActing(action);
      try {
        const res = await fetch(`/corsair/permissions/${encodeURIComponent(token)}/${action}`, {
          method: "POST",
          credentials: "include",
          headers: { "x-thread-csrf": "1" },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        toast.success(action === "approve" ? "Approved and executed via Corsair" : "Request denied");
        setRecord((prev) => (prev ? { ...prev, status: action === "approve" ? "completed" : "denied" } : prev));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed");
      } finally {
        setActing(null);
      }
    },
    [token],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <p className="text-muted-foreground text-sm">Loading Corsair permission request…</p>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">Permission request not found</h1>
      </div>
    );
  }

  const pending = record.status === "pending";

  return (
    <div className="mx-auto max-w-lg space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">Corsair action approval</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Review the requested integration action before Corsair executes it.
        </p>
      </div>

      <dl className="space-y-3 rounded-lg border p-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Plugin</dt>
          <dd className="font-mono">{record.plugin}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="font-mono">{record.endpoint}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{record.status}</dd>
        </div>
        {record.expiresAt ? (
          <div>
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{record.expiresAt}</dd>
          </div>
        ) : null}
        {record.args != null ? (
          <div>
            <dt className="text-muted-foreground">Arguments</dt>
            <dd>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(record.args, null, 2)}
              </pre>
            </dd>
          </div>
        ) : null}
      </dl>

      {pending ? (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={acting !== null}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => void act("approve")}
          >
            {acting === "approve" ? "Executing…" : "Approve & run"}
          </button>
          <button
            type="button"
            disabled={acting !== null}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
            onClick={() => void act("deny")}
          >
            {acting === "deny" ? "Denying…" : "Deny"}
          </button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">This request is no longer pending.</p>
      )}
    </div>
  );
}
