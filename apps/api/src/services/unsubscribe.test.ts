import { describe, expect, it } from "vitest";

import { assertPublicHttpsUrl, parseListUnsubscribe } from "./unsubscribe";

describe("parseListUnsubscribe", () => {
  it("prefers RFC 8058 one-click when the post header is present", () => {
    expect(
      parseListUnsubscribe(
        "<mailto:leave@list.example.com>, <https://list.example.com/u?id=9>",
        "List-Unsubscribe=One-Click",
      ),
    ).toEqual({ method: "one_click", url: "https://list.example.com/u?id=9" });
  });

  it("falls back to mailto with subject/body from the link", () => {
    const info = parseListUnsubscribe("<mailto:leave@list.example.com?subject=stop%20please>, <https://list.example.com/u>");
    expect(info.method).toBe("mailto");
    expect(info.mailto).toEqual({
      to: "leave@list.example.com",
      subject: "stop please",
      body: "Please unsubscribe me from this mailing list.",
    });
    expect(info.url).toBe("https://list.example.com/u");
  });

  it("uses the website only when nothing automatic exists", () => {
    expect(parseListUnsubscribe("<https://list.example.com/u>")).toEqual({
      method: "website",
      url: "https://list.example.com/u",
    });
  });

  it("ignores http and malformed entries", () => {
    expect(parseListUnsubscribe("<http://insecure.example.com/u>, <mailto:not-an-email>")).toEqual({ method: "none" });
    expect(parseListUnsubscribe(undefined)).toEqual({ method: "none" });
  });
});

describe("assertPublicHttpsUrl", () => {
  it("rejects private, loopback and non-https targets", async () => {
    await expect(assertPublicHttpsUrl("https://127.0.0.1/u")).rejects.toThrow(/private/);
    await expect(assertPublicHttpsUrl("https://10.2.3.4/u")).rejects.toThrow(/private/);
    await expect(assertPublicHttpsUrl("https://169.254.169.254/latest")).rejects.toThrow(/private/);
    await expect(assertPublicHttpsUrl("https://[::1]/u")).rejects.toThrow(/private/);
    await expect(assertPublicHttpsUrl("http://example.com/u")).rejects.toThrow(/https/);
    await expect(assertPublicHttpsUrl("https://example.com:8443/u")).rejects.toThrow(/port/);
  });

  it("accepts a public IP literal", async () => {
    await expect(assertPublicHttpsUrl("https://8.8.8.8/u")).resolves.toBeInstanceOf(URL);
  });
});
