type MessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: MessagePart[];
};

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

export function extractPlainBody(payload: MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).trim();
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = decodeBase64Url(payload.body.data);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  for (const part of payload.parts ?? []) {
    const text = extractPlainBody(part);
    if (text) return text;
  }

  return "";
}

export function buildRawEmail(input: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}) {
  const lines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];

  if (input.inReplyTo) {
    lines.push(`In-Reply-To: ${input.inReplyTo}`);
  }
  if (input.references) {
    lines.push(`References: ${input.references}`);
  }

  lines.push("", input.body);
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function parseEmailAddress(value: string | undefined) {
  if (!value) return "";
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}
