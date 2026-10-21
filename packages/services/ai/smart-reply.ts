/**
 * Smart Reply Suggestions
 *
 * When a thread is opened, fetches full thread context via Corsair Gmail
 * (or mail cache when Gmail is disconnected) and generates 3 ready-to-send
 * reply options using OpenAI.
 */
import { getInboxService } from "../inbox";
import { normalizeEmail } from "./daily-brief-time";
import { createChatCompletion, isOpenAiConfigured } from "./openai";
import { EMAIL_VOICE_RULES, humanizeEmailBody } from "./writing-style";

export type SmartReplySuggestion = {
  label: string;
  body: string;
};

export type SmartReplyResult = {
  suggestions: SmartReplySuggestion[];
  replyTo: string;
  replyToName: string;
};

const SYSTEM_PROMPT = `You write reply options for the user's latest email. Generate exactly 3.

Each reply must:
- Answer the latest message specifically and be ready to send as-is
- Take a different stance where it makes sense (e.g. yes / not yet / ask a question), not just different lengths
- Stay short: option 1 is one sentence, option 2 is two or three, option 3 is at most five
- Use a 2-4 word label describing the stance, e.g. "Confirm Thursday", "Ask for the deck", "Decline politely"

Respond with JSON only:
{ "replies": [ { "label": "...", "body": "..." }, { "label": "...", "body": "..." }, { "label": "...", "body": "..." } ] }

No subject line and no greeting line like "Hi [Name],". Body text only.

${EMAIL_VOICE_RULES}`;

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
  const thread = await inbox.getThread(input.tenantId, input.threadId, {
    userEmail: input.userEmail,
  });

  if (!thread?.messages?.length) {
    return { suggestions: [], replyTo: "", replyToName: "" };
  }

  // Who to reply to — last sender that isn't the user (exact email match)
  const userEmailNorm = normalizeEmail(input.userEmail) ?? "";
  const lastExternalMessage = [...(thread.messages ?? [])]
    .reverse()
    .find((m) => {
      const fromNorm = normalizeEmail(m.from) ?? (m.from ?? "").toLowerCase().trim();
      return fromNorm !== userEmailNorm && fromNorm.length > 0;
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
      { jsonObject: true, temperature: 0.5, task: "smart_reply" },
    );

    const parsed = JSON.parse(raw) as RawResult;
    const suggestions = (parsed.replies ?? [])
      .filter((r) => r.label && r.body)
      .slice(0, 3)
      .map((r) => ({ label: r.label!, body: humanizeEmailBody(r.body!) }));

    return { suggestions, replyTo: replyToEmail, replyToName };
  } catch {
    return { suggestions: [], replyTo: replyToEmail, replyToName };
  }
}
