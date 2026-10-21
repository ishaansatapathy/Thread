/**
 * Shared voice for every email Thread writes on the user's behalf, plus a
 * conservative cleanup pass that strips the stock phrases models fall back on.
 * The prompt rules do the real work; the cleanup only removes whole filler
 * sentences and typographic tells, never rewrites content.
 */

export const EMAIL_VOICE_RULES = [
  "EMAIL WRITING STYLE (applies to every email, reply and draft you write for the user):",
  "- Write like a busy, competent person, not an assistant. Plain words, short sentences, no filler.",
  "- Put the point in the first sentence. Do not restate the other person's email back to them.",
  "- Match the thread: mirror the other person's formality, length and language (reply in Hindi/Hinglish if they wrote that way). A one-line question gets a one-or-two-line answer.",
  '- Never open with "I hope this email finds you well", "I hope you are doing well", "I trust this message finds you" or "I wanted to reach out".',
  '- Never close with "Please don\'t hesitate to reach out", "Feel free to reach out if you have any questions" or "Looking forward to hearing from you" unless a reply is genuinely needed.',
  "- Avoid: delve, leverage, utilize, seamless, robust, synergy, circle back, touch base, just wanted to, rest assured, at your earliest convenience.",
  "- No em dashes. Use a comma or a full stop.",
  "- Plain text only: no markdown, no bold, no headings. Use a short list only for 3 or more separate items (dates, steps, options).",
  "- Never invent facts, times, prices or commitments. If something is missing, ask the user or leave a clear placeholder like [time].",
  "- Sign off with just the user's first name, or nothing if the thread does not use sign-offs. No 'Best regards' unless the thread is formal.",
].join("\n");

const FILLER_SENTENCES: RegExp[] = [
  /^i hope (this|my) (e-?mail|message|note) finds you well[.!]?$/i,
  /^i hope you('| a)re (doing )?(well|good|great)[.!]?$/i,
  /^i hope you('| a)re having a (great|good|wonderful) (day|week)[.!]?$/i,
  /^i trust (this|my) (e-?mail|message) finds you well[.!]?$/i,
  /^please (do not|don'?t) hesitate to (reach out|contact me|get in touch)( if you have any (further )?questions)?[.!]?$/i,
  /^feel free to (reach out|contact me|get in touch)( if you have any (further )?questions)?[.!]?$/i,
  /^let me know if you have any (other |further )?questions[.!]?$/i,
  /^thank you for your (time and )?(attention|consideration)( to this matter)?[.!]?$/i,
];

function isFiller(sentence: string) {
  const s = sentence.trim();
  return FILLER_SENTENCES.some((re) => re.test(s));
}

/** Drops filler sentences that sit alone at the start or end of a paragraph. */
function trimFillerFromParagraph(paragraph: string): string {
  let text = paragraph.trim();
  for (;;) {
    const first = text.match(/^[^.!?]+[.!?]+/)?.[0];
    if (!first || !isFiller(first)) break;
    text = text.slice(first.length).trim();
  }
  for (;;) {
    const last = text.match(/(?:^|[.!?]\s+)([^.!?]+[.!?]*)$/);
    const sentence = last?.[1];
    if (!sentence || !isFiller(sentence)) break;
    text = text.slice(0, text.length - sentence.length).trim();
  }
  return text;
}

export function humanizeEmailBody(body: string): string {
  const original = body;
  let text = body.replace(/\r\n/g, "\n");

  text = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/(\w)—(\w)/g, "$1, $2");

  const paragraphs = text.split(/\n{2,}/).map((p) => {
    if (p.includes("\n")) {
      const lines = p.split("\n").filter((line) => !isFiller(line));
      return lines.join("\n");
    }
    return trimFillerFromParagraph(p);
  });

  text = paragraphs
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/,\s*,/g, ",")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > 0 ? text : original.trim();
}
