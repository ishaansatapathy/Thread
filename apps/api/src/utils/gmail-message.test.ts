import { describe, expect, it } from "vitest";

import { collectMessageHeaders, decodeHtmlEntities, extractHtmlBody, findHeaderInThreadMessages } from "./gmail-message";

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
