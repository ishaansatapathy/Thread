import { sanitizeEmailHeader } from "@repo/services/validation/email";

type MessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MessagePart[];
};

function collectAttachments(payload: MessagePart | undefined): Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }> {
  if (!payload) return [];
  const result: Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }> = [];

  function walk(part: MessagePart) {
    const isAttachment =
      part.filename?.trim() &&
      part.mimeType &&
      !part.mimeType.startsWith("text/") &&
      !part.mimeType.startsWith("multipart/");

    if (isAttachment && part.filename) {
      result.push({
        filename: part.filename.trim(),
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId,
      });
    }
    for (const child of part.parts ?? []) walk(child);
  }

  walk(payload);
  return result;
}

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function findPlainTextPart(payload: MessagePart): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    const text = decodeBase64Url(payload.body.data).trim();
    if (text) return text;
  }

  for (const part of payload.parts ?? []) {
    const text = findPlainTextPart(part);
    if (text) return text;
  }

  return "";
}

function findHtmlPart(payload: MessagePart): string {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of payload.parts ?? []) {
    const html = findHtmlPart(part);
    if (html) return html;
  }

  return "";
}

export function extractHtmlBody(payload: MessagePart | undefined): string {
  if (!payload) return "";
  return findHtmlPart(payload);
}

export function extractPlainBody(payload: MessagePart | undefined): string {
  if (!payload) return "";

  const plain = findPlainTextPart(payload);
  if (plain) return plain;

  const html = findHtmlPart(payload);
  if (html) return stripHtmlToText(html);

  return "";
}

export type EmailAttachmentInput = {
  filename: string;
  mimeType: string;
  contentBase64: string;
};

export function buildRawEmail(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: EmailAttachmentInput[];
}) {
  const to = sanitizeEmailHeader(input.to);
  const subject = sanitizeEmailHeader(input.subject);
  const attachments = (input.attachments ?? []).filter((a) => a.contentBase64?.trim());

  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];

  if (input.cc?.trim()) {
    headers.push(`Cc: ${sanitizeEmailHeader(input.cc)}`);
  }
  if (input.bcc?.trim()) {
    headers.push(`Bcc: ${sanitizeEmailHeader(input.bcc)}`);
  }
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${sanitizeEmailHeader(input.inReplyTo)}`);
  }
  if (input.references) {
    headers.push(`References: ${sanitizeEmailHeader(input.references)}`);
  }

  if (attachments.length === 0) {
    headers.push("Content-Type: text/plain; charset=utf-8", "", input.body);
    return Buffer.from(headers.join("\r\n"), "utf8").toString("base64url");
  }

  const boundary = `thread_${Date.now().toString(36)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");

  const parts: string[] = [];
  parts.push(
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    input.body,
  );

  for (const attachment of attachments) {
    const filename = sanitizeEmailHeader(attachment.filename);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType || "application/octet-stream"}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      attachment.contentBase64.replace(/\s/g, ""),
    );
  }

  parts.push(`--${boundary}--`, "");
  return Buffer.from(`${headers.join("\r\n")}\r\n${parts.join("\r\n")}`, "utf8").toString("base64url");
}

export function parseEmailAddress(value: string | undefined) {
  if (!value) return "";
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

type GmailHeader = { name?: string; value?: string };

export type ParsedGmailMessage = {
  id: string;
  from?: string;
  to?: string;
  date?: string;
  body: string;
  bodyHtml?: string;
  snippet: string;
  attachments?: Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }>;
};

export function getHeader(headers: GmailHeader[], name: string) {
  return headers.find((entry) => entry.name?.toLowerCase() === name.toLowerCase())?.value;
}

type HeaderPart = { headers?: GmailHeader[]; parts?: HeaderPart[] };

/** Scan thread messages (newest-first or oldest-first) for a header value. */
export function findHeaderInThreadMessages(
  messages: Array<{ payload?: HeaderPart }>,
  headerName: string,
  order: "first" | "last",
): string | undefined {
  const ordered = order === "first" ? messages : [...messages].reverse();
  for (const message of ordered) {
    const value = getHeader(collectMessageHeaders(message.payload), headerName);
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

/** Walks MIME parts until we find headers (metadata responses often nest them). */
export function collectMessageHeaders(part: HeaderPart | undefined): GmailHeader[] {
  if (!part) return [];
  if (part.headers?.length) return part.headers;
  for (const child of part.parts ?? []) {
    const nested = collectMessageHeaders(child);
    if (nested.length) return nested;
  }
  return [];
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function parseGmailMessage(message: {
  id?: string;
  snippet?: string;
  payload?: MessagePart & { headers?: GmailHeader[] };
}): ParsedGmailMessage | null {
  if (!message.id) return null;

  const headers = message.payload?.headers ?? [];
  const bodyHtml = extractHtmlBody(message.payload) || undefined;
  const body = extractPlainBody(message.payload) || message.snippet || "";
  const attachments = collectAttachments(message.payload);

  return {
    id: message.id,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    date: getHeader(headers, "Date"),
    body,
    bodyHtml,
    snippet: message.snippet ?? body.slice(0, 140),
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

export function normalizeSubject(subject?: string) {
  if (!subject?.trim()) return "No subject";
  let value = subject.trim();
  while (/^(re|fwd):\s*/i.test(value)) {
    value = value.replace(/^(re|fwd):\s*/i, "").trim();
  }
  return value || "No subject";
}

export function displaySender(from?: string) {
  if (!from) return "Unknown";
  const nameMatch = from.match(/^([^<]+)</);
  if (nameMatch?.[1]) {
    return nameMatch[1].trim().replace(/^"|"$/g, "");
  }
  return parseEmailAddress(from);
}

export function suggestReplyTo(
  messages: ParsedGmailMessage[],
  userEmail?: string,
) {
  const me = userEmail?.trim().toLowerCase();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const from = parseEmailAddress(messages[index]?.from).toLowerCase();
    if (from && from !== me) {
      return parseEmailAddress(messages[index]?.from);
    }
  }

  const last = messages[messages.length - 1];
  return parseEmailAddress(last?.to) || parseEmailAddress(messages[0]?.from) || "";
}
