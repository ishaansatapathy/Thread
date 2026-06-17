import { describe, expect, it } from "vitest";

import { collectMessageHeaders, decodeHtmlEntities, extractHtmlBody, findHeaderInThreadMessages, buildRawEmail } from "./gmail-message";

describe("collectMessageHeaders", () => {
  it("returns headers from the root payload", () => {
    const headers = collectMessageHeaders({
      headers: [{ name: "Subject", value: "Hello" }],
    });
    expect(headers).toEqual([{ name: "Subject", value: "Hello" }]);
  });

  it("walks nested MIME parts for headers", () => {
    const headers = collectMessageHeaders({
      parts: [
        {
          headers: [{ name: "From", value: "Ada <ada@example.com>" }],
        },
      ],
    });
    expect(headers[0]?.value).toBe("Ada <ada@example.com>");
  });
});

describe("findHeaderInThreadMessages", () => {
  it("finds From on the newest message first", () => {
    const from = findHeaderInThreadMessages(
      [
        { payload: { headers: [{ name: "From", value: "Old <old@example.com>" }] } },
        { payload: { headers: [{ name: "From", value: "New <new@example.com>" }] } },
      ],
      "From",
      "last",
    );
    expect(from).toBe("New <new@example.com>");
  });

  it("finds Subject on the oldest message first", () => {
    const subject = findHeaderInThreadMessages(
      [
        { payload: { headers: [{ name: "Subject", value: "Original topic" }] } },
        { payload: { headers: [{ name: "Subject", value: "Re: Original topic" }] } },
      ],
      "Subject",
      "first",
    );
    expect(subject).toBe("Original topic");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes numeric and named entities in snippets", () => {
    expect(decodeHtmlEntities("It&#39;s Friday")).toBe("It's Friday");
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
  });
});

describe("extractHtmlBody", () => {
  it("returns decoded HTML from nested MIME parts", () => {
    const html = extractHtmlBody({
      parts: [
        {
          mimeType: "text/html",
          body: { data: Buffer.from("<p>Hello <strong>world</strong></p>").toString("base64url") },
        },
      ],
    });
    expect(html).toContain("<strong>world</strong>");
  });
});

describe("buildRawEmail", () => {
  it("builds multipart email when attachments are present", () => {
    const raw = buildRawEmail({
      to: "guest@example.com",
      subject: "Files",
      body: "See attached",
      attachments: [
        {
          filename: "note.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("hello").toString("base64"),
        },
      ],
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("multipart/mixed");
    expect(decoded).toContain("note.txt");
    expect(decoded).toContain("See attached");
  });

  it("includes Cc header when cc is provided", () => {
    const raw = buildRawEmail({
      to: "to@example.com",
      subject: "With CC",
      body: "Hello",
      cc: "cc@example.com",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("Cc: cc@example.com");
    expect(decoded).not.toContain("Bcc:");
  });

  it("includes Bcc header when bcc is provided", () => {
    const raw = buildRawEmail({
      to: "to@example.com",
      subject: "With BCC",
      body: "Hello",
      bcc: "bcc@example.com",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("Bcc: bcc@example.com");
    expect(decoded).not.toContain("Cc:");
  });

  it("includes both Cc and Bcc when both are provided", () => {
    const raw = buildRawEmail({
      to: "to@example.com",
      subject: "Both",
      body: "Hello",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("Cc: cc@example.com");
    expect(decoded).toContain("Bcc: bcc@example.com");
  });

  it("omits Cc/Bcc headers when not provided", () => {
    const raw = buildRawEmail({ to: "to@example.com", subject: "Plain", body: "Hi" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).not.toContain("Cc:");
    expect(decoded).not.toContain("Bcc:");
  });
});
