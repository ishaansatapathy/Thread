import { z } from "zod";

import { ServiceError } from "../errors";
import { createChatCompletion, isOpenAiConfigured } from "./openai";

export type InboxRankInput = {
  id: string;
  snippet: string;
  subject?: string;
  from?: string;
};

const rankResponseSchema = z.object({
  rankedIds: z.array(z.string()),
});

function buildRankPrompt(threads: InboxRankInput[]) {
  const lines = threads.map((thread, index) => {
    const subject = thread.subject?.trim() || "No subject";
    const from = thread.from?.trim() || "Unknown sender";
    const snippet = thread.snippet.trim() || "(empty)";
    return `${index + 1}. id=${thread.id}\n   from=${from}\n   subject=${subject}\n   snippet=${snippet}`;
  });

  return [
    "Rank these email threads by urgency for a busy professional.",
    "Consider deadlines, direct asks, billing/security, and replies waiting on the user.",
    "Return JSON only: {\"rankedIds\":[\"id-most-urgent\", ...]}",
    "Include every thread id exactly once. Most urgent first.",
    "",
    ...lines,
  ].join("\n");
}

export function isInboxAiConfigured() {
  return isOpenAiConfigured();
}

export async function rankInboxThreads(threads: InboxRankInput[]): Promise<string[]> {
  if (!isOpenAiConfigured()) {
    throw new ServiceError("PRECONDITION_FAILED", "OpenAI is not configured. Set OPENAI_API_KEY.");
  }

  if (threads.length === 0) return [];
  if (threads.length === 1) return [threads[0]!.id];

  const content = await createChatCompletion(
    [
      {
        role: "system",
        content:
          "You triage email threads by urgency. Respond with valid JSON only — no markdown.",
      },
      { role: "user", content: buildRankPrompt(threads) },
    ],
    { jsonObject: true, temperature: 0.1 },
  );

  let parsed: z.infer<typeof rankResponseSchema>;
  try {
    parsed = rankResponseSchema.parse(JSON.parse(content));
  } catch {
    throw new ServiceError("INTERNAL", "Could not parse AI ranking response.");
  }

  const knownIds = new Set(threads.map((thread) => thread.id));
  const ranked = parsed.rankedIds.filter((id) => knownIds.has(id));
  const missing = threads.map((thread) => thread.id).filter((id) => !ranked.includes(id));

  return [...ranked, ...missing];
}
