import { describe, expect, it } from "vitest";

import { markdownToDocsRequests, parseInlineMarkdown, parseMarkdownBlocks } from "./markdown-to-docs";
import { escapeDriveQuery, quoteSheetName, sanitizeSheetCell } from "./workspace-format";

type Req = Record<string, Record<string, unknown>>;

describe("parseInlineMarkdown", () => {
  it("strips markers and records bold, italic, code and link ranges", () => {
    const { text, ranges } = parseInlineMarkdown("Use **bold**, *it*, `code` and [site](https://x.dev)");
    expect(text).toBe("Use bold, it, code and site");
    expect(ranges).toEqual(
      expect.arrayContaining([
        { start: 4, end: 8, bold: true },
        { start: 10, end: 12, italic: true },
        { start: 14, end: 18, code: true },
        { start: 23, end: 27, link: "https://x.dev" },
      ]),
    );
  });

  it("leaves snake_case and arithmetic asterisks alone", () => {
    expect(parseInlineMarkdown("file_name_v2 and 2 * 3 * 4").text).toBe("file_name_v2 and 2 * 3 * 4");
  });

  it("keeps an unclosed marker as literal text", () => {
    expect(parseInlineMarkdown("price **50").text).toBe("price **50");
  });
});

describe("parseMarkdownBlocks", () => {
  it("classifies headings, lists, quotes, code and collapses blank lines", () => {
    const blocks = parseMarkdownBlocks("# Title\n\n\n- one\n- [x] two\n1. first\n> note\n```\nconst a = 1;\n```\n---\nend\n\n");
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ["heading", "Title"],
      ["paragraph", ""],
      ["bullet", "one"],
      ["bullet", "two"],
      ["number", "first"],
      ["quote", "note"],
      ["code", "const a = 1;"],
      ["paragraph", "end"],
    ]);
  });
});

describe("markdownToDocsRequests", () => {
  it("inserts plain text once, then styles by UTF-16 index", () => {
    const { text, requests } = markdownToDocsRequests("## Plan\n- **Ship** it\n- Test\n\nDone");
    expect(text).toBe("Plan\nShip it\nTest\n\nDone");
    const [insert, ...rest] = requests as Req[];
    expect(insert).toEqual({ insertText: { location: { index: 1 }, text } });

    const heading = rest.find((r) => r.updateParagraphStyle);
    expect(heading?.updateParagraphStyle).toMatchObject({
      range: { startIndex: 1, endIndex: 5 },
      paragraphStyle: { namedStyleType: "HEADING_2" },
    });

    const bullets = rest.filter((r) => r.createParagraphBullets);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]?.createParagraphBullets).toMatchObject({
      range: { startIndex: 6, endIndex: 18 },
      bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
    });

    const bold = rest.find((r) => (r.updateTextStyle?.textStyle as { bold?: boolean } | undefined)?.bold);
    expect(bold?.updateTextStyle).toMatchObject({ range: { startIndex: 6, endIndex: 10 } });
  });

  it("splits bullet and numbered runs into separate list requests", () => {
    const { requests } = markdownToDocsRequests("- a\n- b\n1. c\n2. d");
    const presets = (requests as Req[])
      .filter((r) => r.createParagraphBullets)
      .map((r) => r.createParagraphBullets?.bulletPreset);
    expect(presets).toEqual(["BULLET_DISC_CIRCLE_SQUARE", "NUMBERED_DECIMAL_ALPHA_ROMAN"]);
  });

  it("counts emoji as two UTF-16 units like Google Docs does", () => {
    const { requests } = markdownToDocsRequests("😀 **x**");
    const bold = (requests as Req[]).find((r) => r.updateTextStyle);
    expect(bold?.updateTextStyle).toMatchObject({ range: { startIndex: 4, endIndex: 5 } });
  });

  it("returns nothing for whitespace-only input", () => {
    expect(markdownToDocsRequests("  \n\n ").requests).toEqual([]);
  });
});

describe("workspace-format", () => {
  it("neutralises formula-like sheet cells but keeps numbers", () => {
    expect(sanitizeSheetCell('=IMPORTXML("https://evil", "//a")')).toBe('\'=IMPORTXML("https://evil", "//a")');
    expect(sanitizeSheetCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeSheetCell("+91 98765")).toBe("'+91 98765");
    expect(sanitizeSheetCell("-42.5")).toBe("-42.5");
    expect(sanitizeSheetCell("+1,200")).toBe("+1,200");
    expect(sanitizeSheetCell("Invoice 7")).toBe("Invoice 7");
  });

  it("escapes Drive query literals and quotes sheet names", () => {
    expect(escapeDriveQuery("Q3 'final' \\ notes")).toBe("Q3 \\'final\\' \\\\ notes");
    expect(quoteSheetName("Ishaan's data")).toBe("'Ishaan''s data'");
  });
});
