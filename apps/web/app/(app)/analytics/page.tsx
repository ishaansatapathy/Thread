"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart2, CheckCircle2, Clock, Mail, Calendar, XCircle, AlertTriangle, Inbox as InboxIcon } from "lucide-react";

import { trpc } from "~/trpc/client";
import { SkeletonList } from "~/components/app/skeleton-list";

const KIND_LABELS: Record<string, string> = {
  email_send: "Email send",
  email_draft: "Email draft",
  calendar_invite: "Calendar invite",
  meeting_bundle: "Meeting bundle",
  calendar_archive: "Calendar archive",
  calendar_delete: "Calendar delete",
};

const PIE_COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#a78bfa", "#f472b6", "#38bdf8"];

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  suffix,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent?: string;
  suffix?: string;
}) {
  return (
    <div
      className="thread-rotator-bubble"
      style={{
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
        padding: "16px 20px",
        minWidth: 130,
        flex: "1 1 130px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: accent ?? "var(--thread-muted)" }}>
        <Icon size={13} />
        <span style={{ fontSize: 11, fontFamily: "var(--thread-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize: 28, fontWeight: 700, color: "var(--thread-text)", lineHeight: 1 }}>
        {value}
        {suffix ? <span style={{ fontSize: 16, fontWeight: 600, marginLeft: 2 }}>{suffix}</span> : null}
      </span>
    </div>
  );
}

export default function AnalyticsPage() {
  const stats = trpc.queue.stats.useQuery({}, { staleTime: 60_000, refetchInterval: 60_000 });
  const observability = trpc.observability.summary.useQuery({}, { staleTime: 30_000, refetchInterval: 30_000 });
  const inboxStatus = trpc.inbox.connectionStatus.useQuery({});
  const calendarStatus = trpc.calendar.connectionStatus.useQuery({});

  const data = stats.data;
  const resolved = (data?.approved ?? 0) + (data?.dismissed ?? 0);
  const approvalRate = resolved > 0 ? Math.round(((data?.approved ?? 0) / resolved) * 100) : null;

  const pieData = data
    ? Object.entries(data.byKind).map(([kind, value]) => ({
        name: KIND_LABELS[kind] ?? kind,
        value,
      }))
    : [];

  return (
    <div className="thread-app-page">
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 28 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BarChart2 size={18} style={{ opacity: 0.7 }} />
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--thread-text)" }}>Analytics</h1>
          <span className="thread-mono-tag" style={{ marginLeft: "auto", fontSize: 11 }}>Queue activity</span>
        </div>

        {/* Stat cards */}
        {stats.isLoading ? (
          <SkeletonList count={4} />
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatCard label="Total" value={data?.total ?? 0} icon={BarChart2} />
            <StatCard label="Pending" value={data?.pending ?? 0} icon={Clock} accent="#f59e0b" />
            <StatCard label="Approved" value={data?.approved ?? 0} icon={CheckCircle2} accent="#34d399" />
            <StatCard label="Dismissed" value={data?.dismissed ?? 0} icon={XCircle} accent="var(--thread-muted)" />
            {approvalRate !== null ? (
              <StatCard label="Approval rate" value={approvalRate} icon={CheckCircle2} accent="#60a5fa" suffix="%" />
            ) : null}
            {(data?.failed ?? 0) > 0 && (
              <StatCard label="Failed" value={data?.failed ?? 0} icon={AlertTriangle} accent="#f87171" />
            )}
          </div>
        )}

        {/* Integrations */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="thread-rotator-bubble" style={{ flex: "1 1 180px", padding: "12px 16px", gap: 6, flexDirection: "column", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--thread-muted)" }}>
              <InboxIcon size={12} />
              <span style={{ fontSize: 11, fontFamily: "var(--thread-mono)", textTransform: "uppercase" }}>Gmail</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--thread-text)" }}>
              {inboxStatus.data?.gmail === "connected" ? "Connected" : "Not connected"}
            </span>
          </div>
          <div className="thread-rotator-bubble" style={{ flex: "1 1 180px", padding: "12px 16px", gap: 6, flexDirection: "column", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--thread-muted)" }}>
              <Calendar size={12} />
              <span style={{ fontSize: 11, fontFamily: "var(--thread-mono)", textTransform: "uppercase" }}>Calendar</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--thread-text)" }}>
              {calendarStatus.data?.googlecalendar === "connected" ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>

        <div
          className="thread-rotator-bubble"
          style={{ flexDirection: "column", alignItems: "stretch", gap: 10, padding: "16px 20px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <InboxIcon size={13} style={{ opacity: 0.6 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--thread-text)" }}>Inbox performance</span>
          </div>
          {observability.isLoading ? (
            <SkeletonList count={2} />
          ) : (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatCard
                label="Cache hits"
                value={observability.data?.inboxCacheHits ?? 0}
                icon={InboxIcon}
                accent="#60a5fa"
              />
              <StatCard
                label="MCP tool calls"
                value={observability.data?.mcpToolCalls ?? 0}
                icon={BarChart2}
              />
            </div>
          )}
        </div>

        {/* Timeline chart */}
        <div
          className="thread-rotator-bubble"
          style={{ flexDirection: "column", alignItems: "stretch", gap: 14, padding: "20px 20px 12px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Mail size={13} style={{ opacity: 0.6 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--thread-text)" }}>14-day activity</span>
          </div>

          {stats.isLoading ? (
            <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--thread-muted)", fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data?.timeline ?? []} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <defs>
                  <linearGradient id="colorQueued" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorApproved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "var(--thread-dim)" }}
                  axisLine={false}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: "var(--thread-dim)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0d0d0d",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--thread-text)",
                  }}
                  itemStyle={{ color: "var(--thread-muted)" }}
                />
                <Area
                  type="monotone"
                  dataKey="queued"
                  name="Queued"
                  stroke="#60a5fa"
                  strokeWidth={1.5}
                  fill="url(#colorQueued)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="approved"
                  name="Approved"
                  stroke="#34d399"
                  strokeWidth={1.5}
                  fill="url(#colorApproved)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}

          <div style={{ display: "flex", gap: 16, marginTop: 2 }}>
            {[
              { color: "#60a5fa", label: "Queued" },
              { color: "#34d399", label: "Approved" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 2, background: item.color, borderRadius: 2, display: "inline-block" }} />
                <span style={{ fontSize: 11, color: "var(--thread-dim)" }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action type distribution */}
        {pieData.length > 0 && (
          <div
            className="thread-rotator-bubble"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 14, padding: "20px 20px 16px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Calendar size={13} style={{ opacity: 0.6 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--thread-text)" }}>Action breakdown</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={44}
                    outerRadius={72}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} opacity={0.85} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#0d0d0d",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--thread-text)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pieData.map((entry, index) => (
                  <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: PIE_COLORS[index % PIE_COLORS.length],
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--thread-muted)" }}>{entry.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--thread-text)", marginLeft: "auto", paddingLeft: 16 }}>
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!stats.isLoading && data?.total === 0 && (
          <div
            className="thread-rotator-bubble"
            style={{ justifyContent: "center", padding: "40px 24px", flexDirection: "column", alignItems: "center", gap: 8 }}
          >
            <BarChart2 size={20} style={{ opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: 13, color: "var(--thread-muted)", textAlign: "center" }}>
              No queue activity yet. Use the Agent or compose an email to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
