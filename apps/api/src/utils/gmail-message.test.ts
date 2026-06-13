import { describe, expect, it } from "vitest";

import { collectMessageHeaders, decodeHtmlEntities, extractHtmlBody } from "./gmail-message";

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
