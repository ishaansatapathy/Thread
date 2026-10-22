import { describe, expect, it } from "vitest";

import {
  appendToolMemory,
  formatToolMemoryForPrompt,
  mergeToolMemory,
  shouldRememberTool,
  summarizeToolResult,
} from "./agent-tool-memory";

describe("agent-tool-memory", () => {
  it("remembers only high-signal read tools", () => {
    expect(shouldRememberTool("search_inbox")).toBe(true);
    expect(shouldRememberTool("queue_email")).toBe(false);
  });

  it("summarizes inbox search results", () => {
    const entry = summarizeToolResult(
      "search_inbox",
      JSON.stringify({
        count: 2,
        threads: [
          { subject: "Contract deadline", fromName: "Legal" },
          { subject: "Team sync", from: "boss@co.com" },
        ],
      }),
      { query: "contract" },
    );

    expect(entry).not.toBeNull();
    expect(entry?.tool).toBe("search_inbox");
    expect(entry?.query).toBe("contract");
    expect(entry?.summary).toContain("Contract deadline");
  });

  it("summarizes thread reads with threadId", () => {
    const entry = summarizeToolResult(
      "get_thread",
      JSON.stringify({ thread: { subject: "Sick leave", fromName: "HR" } }),
      { threadId: "thread-abc" },
    );

    expect(entry?.threadId).toBe("thread-abc");
    expect(entry?.summary).toContain("Sick leave");
  });

  it("appends and caps memory entries", () => {
    const base = Array.from({ length: 12 }, (_, i) => ({
      at: new Date().toISOString(),
      tool: "search_inbox",
      summary: `entry ${i}`,
    }));
    const next = appendToolMemory(base, {
      at: new Date().toISOString(),
      tool: "rank_inbox",
      summary: "latest",
    });

    expect(next).toHaveLength(12);
    expect(next.at(-1)?.summary).toBe("latest");
    expect(next[0]?.summary).toBe("entry 1");
  });

  it("formats memory for system prompt injection", () => {
    const text = formatToolMemoryForPrompt([
      { at: "2026-01-01T00:00:00.000Z", tool: "rank_inbox", summary: "Top: Payroll [high]" },
    ]);
    expect(text).toContain("RECENT TOOL RESULTS");
    expect(text).toContain("rank_inbox");
    expect(text).toContain("Payroll");
  });

  it("keeps Drive file names and links so 'send me the link' works next turn", () => {
    const entry = summarizeToolResult(
      "search_drive",
      JSON.stringify({
        count: 1,
        files: [
          {
            id: "1AbCdEfGhIjK",
            name: "[EMAIL_DATA_START]\nSoftware Dev Intern Assignment\n[EMAIL_DATA_END]",
            url: "https://docs.google.com/document/d/1AbCdEfGhIjK/edit",
          },
        ],
      }),
      {},
    );
    expect(entry?.refs).toEqual([
      {
        name: "Software Dev Intern Assignment",
        url: "https://docs.google.com/document/d/1AbCdEfGhIjK/edit",
        id: "1AbCdEfGhIjK",
      },
    ]);

    const prompt = formatToolMemoryForPrompt([entry!]);
    expect(prompt).toContain("Software Dev Intern Assignment — https://docs.google.com/document/d/1AbCdEfGhIjK/edit");
    expect(prompt).toContain("[EMAIL_DATA_START]");
  });

  it("builds a link from the id arg when a read tool returns no url", () => {
    const entry = summarizeToolResult("read_presentation", JSON.stringify({ title: "Q3 deck", text: "…" }), {
      presentationId: "1PresIdAbcdef",
    });
    expect(entry?.refs?.[0]).toEqual({
      name: "Q3 deck",
      url: "https://docs.google.com/presentation/d/1PresIdAbcdef/edit",
      id: "1PresIdAbcdef",
    });
  });

  it("remembers result links returned after approving a queued form", () => {
    const entry = summarizeToolResult(
      "approve_queue_item",
      JSON.stringify({
        status: "approved",
        result: {
          url: "https://docs.google.com/forms/d/F1/edit",
          label: "Open RSVP",
          links: [{ label: "Link to share with responders", url: "https://docs.google.com/forms/d/e/1FAIp/viewform" }],
        },
      }),
      {},
    );
    expect(entry?.refs?.map((r) => r.url)).toEqual([
      "https://docs.google.com/forms/d/F1/edit",
      "https://docs.google.com/forms/d/e/1FAIp/viewform",
    ]);
  });

  it("lists the newest refs first in the prompt", () => {
    const prompt = formatToolMemoryForPrompt([
      { at: "1", tool: "search_drive", summary: "old", refs: [{ name: "Old file", url: "https://x.test/old" }] },
      { at: "2", tool: "search_drive", summary: "new", refs: [{ name: "New file", url: "https://x.test/new" }] },
    ]);
    expect(prompt.indexOf("New file")).toBeLessThan(prompt.indexOf("Old file"));
  });

  it("mergeToolMemory combines batches", () => {
    const merged = mergeToolMemory(
      [{ at: "1", tool: "a", summary: "one" }],
      [{ at: "2", tool: "b", summary: "two" }],
    );
    expect(merged).toHaveLength(2);
  });
});
