/**
 * Converts a small, predictable subset of markdown into a Google Docs batchUpdate:
 * one insertText followed by paragraph, bullet and text-style requests.
 * Indices are UTF-16 code units, which is what both JS strings and Docs use.
 */

type InlineRange = {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
};

type BlockKind = "heading" | "bullet" | "number" | "paragraph" | "quote" | "code";

type Block = {
  kind: BlockKind;
  level?: number;
  text: string;
  ranges: InlineRange[];
};

export type DocsRequest = Record<string, unknown>;

function shift(ranges: InlineRange[], by: number) {
  return ranges.map((r) => ({ ...r, start: r.start + by, end: r.end + by }));
}

export function parseInlineMarkdown(src: string): { text: string; ranges: InlineRange[] } {
  let out = "";
  const ranges: InlineRange[] = [];
  let i = 0;

  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i]!;

    if (ch === "[") {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(rest);
      if (link) {
        const inner = parseInlineMarkdown(link[1]!);
        const start = out.length;
        out += inner.text;
        ranges.push(...shift(inner.ranges, start), { start, end: out.length, link: link[2] });
        i += link[0].length;
        continue;
      }
    }

    if (rest.startsWith("**") || rest.startsWith("__")) {
      const marker = rest.slice(0, 2);
      const close = src.indexOf(marker, i + 2);
      if (close > i + 2) {
        const inner = parseInlineMarkdown(src.slice(i + 2, close));
        const start = out.length;
        out += inner.text;
        ranges.push(...shift(inner.ranges, start), { start, end: out.length, bold: true });
        i = close + 2;
        continue;
      }
    }

    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i + 1) {
        const start = out.length;
        out += src.slice(i + 1, close);
        ranges.push({ start, end: out.length, code: true });
        i = close + 1;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && src[i + 1] !== ch && src[i + 1] !== " " && src[i + 1] !== undefined) {
      const prev = i > 0 ? src[i - 1]! : " ";
      // Underscores inside words (snake_case) are not emphasis.
      const opensOk = ch === "*" || !/\w/.test(prev);
      const close = src.indexOf(ch, i + 1);
      const closesOk =
        close > i + 1 && src[close - 1] !== " " && (ch === "*" || !/\w/.test(src[close + 1] ?? " "));
      if (opensOk && closesOk) {
        const inner = parseInlineMarkdown(src.slice(i + 1, close));
        const start = out.length;
        out += inner.text;
        ranges.push(...shift(inner.ranges, start), { start, end: out.length, italic: true });
        i = close + 1;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return { text: out, ranges };
}

export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let inCode = false;

  const push = (kind: BlockKind, raw: string, level?: number) => {
    if (kind === "code") {
      blocks.push({ kind, text: raw, ranges: raw ? [{ start: 0, end: raw.length, code: true }] : [] });
      return;
    }
    const { text, ranges } = parseInlineMarkdown(raw);
    blocks.push({ kind, level, text, ranges });
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      push("code", line);
      continue;
    }
    if (line.trim() === "") {
      const last = blocks[blocks.length - 1];
      if (last && !(last.kind === "paragraph" && last.text === "")) {
        blocks.push({ kind: "paragraph", text: "", ranges: [] });
      }
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      push("heading", heading[2]!.replace(/\s+#+\s*$/, ""), heading[1]!.length);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (bullet) {
      push("bullet", bullet[1]!);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      push("number", numbered[1]!);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      push("quote", quote[1]!);
      continue;
    }
    push("paragraph", line.trim());
  }

  while (blocks.length > 0 && blocks[blocks.length - 1]!.text === "" && blocks[blocks.length - 1]!.kind === "paragraph") {
    blocks.pop();
  }
  while (blocks.length > 0 && blocks[0]!.text === "" && blocks[0]!.kind === "paragraph") {
    blocks.shift();
  }
  return blocks;
}

export function markdownToDocsRequests(
  markdown: string,
  startIndex = 1,
): { text: string; requests: DocsRequest[] } {
  const blocks = parseMarkdownBlocks(markdown);
  if (blocks.length === 0) return { text: "", requests: [] };

  const text = blocks.map((b) => b.text).join("\n");
  const requests: DocsRequest[] = [{ insertText: { location: { index: startIndex }, text } }];
  const paragraphStyles: DocsRequest[] = [];
  const bulletRequests: DocsRequest[] = [];
  const textStyles: DocsRequest[] = [];

  let offset = 0;
  let listRun: { kind: "bullet" | "number"; start: number; end: number } | null = null;

  const flushList = () => {
    if (!listRun) return;
    bulletRequests.push({
      createParagraphBullets: {
        range: { startIndex: listRun.start, endIndex: listRun.end },
        bulletPreset:
          listRun.kind === "bullet" ? "BULLET_DISC_CIRCLE_SQUARE" : "NUMBERED_DECIMAL_ALPHA_ROMAN",
      },
    });
    listRun = null;
  };

  for (const block of blocks) {
    const start = startIndex + offset;
    const end = start + block.text.length;
    offset += block.text.length + 1;

    if (block.kind === "bullet" || block.kind === "number") {
      if (block.text.length > 0) {
        if (listRun && listRun.kind === block.kind) {
          listRun.end = end;
        } else {
          flushList();
          listRun = { kind: block.kind, start, end };
        }
      }
    } else {
      flushList();
    }

    if (block.text.length === 0) continue;

    if (block.kind === "heading") {
      paragraphStyles.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: { namedStyleType: `HEADING_${Math.min(block.level ?? 1, 6)}` },
          fields: "namedStyleType",
        },
      });
    } else if (block.kind === "quote") {
      paragraphStyles.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: { indentStart: { magnitude: 18, unit: "PT" }, indentFirstLine: { magnitude: 18, unit: "PT" } },
          fields: "indentStart,indentFirstLine",
        },
      });
      textStyles.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: end },
          textStyle: { italic: true },
          fields: "italic",
        },
      });
    }

    for (const r of block.ranges) {
      if (r.end <= r.start) continue;
      const range = { startIndex: start + r.start, endIndex: start + r.end };
      if (r.bold) textStyles.push({ updateTextStyle: { range, textStyle: { bold: true }, fields: "bold" } });
      if (r.italic) textStyles.push({ updateTextStyle: { range, textStyle: { italic: true }, fields: "italic" } });
      if (r.code) {
        textStyles.push({
          updateTextStyle: {
            range,
            textStyle: { weightedFontFamily: { fontFamily: "Roboto Mono" } },
            fields: "weightedFontFamily",
          },
        });
      }
      if (r.link) {
        textStyles.push({ updateTextStyle: { range, textStyle: { link: { url: r.link } }, fields: "link" } });
      }
    }
  }
  flushList();

  return { text, requests: [...requests, ...paragraphStyles, ...bulletRequests, ...textStyles] };
}
