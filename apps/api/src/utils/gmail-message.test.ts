import { describe, expect, it } from "vitest";

import { collectMessageHeaders, decodeHtmlEntities } from "./gmail-message";

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
