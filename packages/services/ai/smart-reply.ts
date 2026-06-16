/**
 * Smart Reply Suggestions
 *
 * When a thread is opened, fetches full thread context via Corsair Gmail
 * and generates 3 ready-to-send reply options using OpenAI.
 *
 * Flow: Corsair Gmail (full thread) → OpenAI → 3 reply options
 */
import { getInboxService } from "../inbox";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type SmartReplySuggestion = {
  label: string;
  body: string;
};

export type SmartReplyResult = {
  suggestions: SmartReplySuggestion[];
  replyTo: string;
  replyToName: string;
};

const SYSTEM_PROMPT = `You are an expert email assistant. Based on the email thread provided, generate exactly 3 smart reply options.

Each reply should:
- Be ready to send as-is (complete, professional)
- Address the latest message in the thread specifically
- Vary in length and tone: one short (1-2 sentences), one standard (2-3 sentences), one detailed (3-5 sentences)

Respond with JSON only:
{
  "replies": [
    { "label": "Quick acknowledgement", "body": "..." },
    { "label": "Standard reply",       "body": "..." },
    { "label": "Detailed response",    "body": "..." }
  ]
}

Do NOT include subject line or greeting like "Hi [Name]," — just the message body.
Keep each reply direct and professional.`;

function buildThreadSummary(messages: Array<{ from?: string; body: string; date?: string }>): string {
  return messages
    .slice(-5) // Last 5 messages for context
    .map((m, i) => {
      const from = m.from ?? "Unknown";
      const date = m.date ? new Date(m.date).toLocaleDateString() : "";
      const body = m.body.slice(0, 400).replace(/\n{3,}/g, "\n\n");
      return `[Message ${i + 1}] From: ${from}${date ? ` (${date})` : ""}\n${body}`;
    })
    .join("\n\n---\n\n");
}

export async function getSmartReplies(input: {
  tenantId: string;
  threadId: string;
  userEmail?: string;
}): Promise<SmartReplyResult> {
  if (!isOpenAiConfigured()) {
    return { suggestions: [], replyTo: "", replyToName: "" };
  }

  const inbox = getInboxService();
  const status = await inbox.getConnectionStatus(input.tenantId);
  if (status.gmail !== "connected") {
    return { suggestions: [], replyTo: "", replyToName: "" };
  }

  const thread = await inbox.getThread(input.tenantId, input.threadId, {
    userEmail: input.userEmail,
  });

  if (!thread?.messages?.length) {
    return { suggestions: [], replyTo: "", replyToName: "" };
  }

  // Who to reply to — last sender that isn't the user
  const userEmail = input.userEmail?.toLowerCase().trim() ?? "";
  const lastExternalMessage = [...(thread.messages ?? [])]
    .reverse()
    .find((m) => {
      const fromEmail = (m.from ?? "").toLowerCase();
      return !fromEmail.includes(userEmail.split("@")[0] ?? "__none__") &&
        fromEmail !== userEmail;
    });

  const replyToRaw = lastExternalMessage?.from ?? thread.from ?? "";
  const replyToEmail = replyToRaw.includes("<")
    ? (replyToRaw.match(/<([^>]+)>/)?.[1] ?? replyToRaw)
    : replyToRaw;
  const replyToName = replyToRaw.includes("<")
    ? replyToRaw.split("<")[0]?.trim() ?? replyToEmail
    : replyToEmail.split("@")[0] ?? replyToEmail;

  const threadSummary = buildThreadSummary(thread.messages);
  const subject = thread.subject?.trim() ?? "(no subject)";

  const prompt = `Subject: ${subject}

Thread:
${threadSummary}

Generate 3 smart reply options for the latest message above.`;

  type RawResult = { replies?: Array<{ label?: string; body?: string }> };

  try {
    const raw = await createChatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      { jsonObject: true, temperature: 0.5 },
    );

    const parsed = JSON.parse(raw) as RawResult;
    const suggestions = (parsed.replies ?? [])
      .filter((r) => r.label && r.body)
      .slice(0, 3)
      .map((r) => ({ label: r.label!, body: r.body! }));

    return { suggestions, replyTo: replyToEmail, replyToName };
  } catch {
    return { suggestions: [], replyTo: replyToEmail, replyToName };
  }
}
