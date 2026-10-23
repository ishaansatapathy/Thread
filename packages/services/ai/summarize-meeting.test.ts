import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./openai", async () => {
  const actual = await vi.importActual<typeof import("./openai")>("./openai");
  return { ...actual, createChatCompletion: vi.fn() };
});

import { createChatCompletion } from "./openai";
import { foldMeetingNotes, summarizeMeeting } from "./summarize-meeting";

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  vi.mocked(createChatCompletion).mockReset();
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

describe("summarizeMeeting", () => {
  it("skips the API call for a silent recording", async () => {
    const notes = await summarizeMeeting({ transcript: "", segments: [] });
    expect(notes.summary).toContain("No speech");
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it("falls back to a raw excerpt when OpenAI isn't configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const notes = await summarizeMeeting({ transcript: "Let's ship Friday.", segments: [] });
    expect(notes.summary).toBe("Let's ship Friday.");
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it("formats diarized segments as 'Speaker N: text' in the prompt sent to OpenAI", async () => {
    vi.mocked(createChatCompletion).mockResolvedValue(
      JSON.stringify({
        summary: "Team agreed to ship Friday.",
        keyPoints: ["Release date"],
        decisions: ["Ship on Friday"],
        actionItems: [{ action: "Deploy", owner: "Priya", deadline: "Friday" }],
      }),
    );

    const notes = await summarizeMeeting({
      transcript: "fallback text",
      segments: [
        { speakerId: "1", startTime: 0, endTime: 1, text: "When do we ship?" },
        { speakerId: "2", startTime: 1, endTime: 2, text: "Let's do Friday." },
      ],
      title: "Launch sync",
    });

    expect(notes).toEqual({
      summary: "Team agreed to ship Friday.",
      keyPoints: ["Release date"],
      decisions: ["Ship on Friday"],
      actionItems: [{ action: "Deploy", owner: "Priya", deadline: "Friday" }],
    });

    const [messages] = vi.mocked(createChatCompletion).mock.calls[0]!;
    const userMessage = messages.find((m) => m.role === "user")!.content;
    expect(userMessage).toContain("Speaker 1: When do we ship?");
    expect(userMessage).toContain("Speaker 2: Let's do Friday.");
    expect(userMessage).toContain("Launch sync");
  });

  it("folds only the new lines into the previous notes, labelling live speakers", async () => {
    vi.mocked(createChatCompletion).mockResolvedValue(
      JSON.stringify({ summary: "Pricing agreed.", keyPoints: ["Pricing", "Launch"], decisions: ["499"], actionItems: [] }),
    );
    const previous = { summary: "Launch planning.", keyPoints: ["Launch"], decisions: [], actionItems: [] };

    const notes = await foldMeetingNotes({
      previous,
      newSegments: [
        { speakerId: "meeting", startTime: 60, endTime: 62, text: "Price stays at 499." },
        { speakerId: "you", startTime: 63, endTime: 64, text: "Agreed." },
      ],
    });

    expect(notes.decisions).toEqual(["499"]);
    const [messages, opts] = vi.mocked(createChatCompletion).mock.calls[0]!;
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain(JSON.stringify(previous));
    expect(user).toContain("Meeting: Price stays at 499.");
    expect(user).toContain("You: Agreed.");
    expect(opts).toMatchObject({ task: "summarize_meeting", jsonObject: true });
  });

  it("keeps the previous notes if a fold fails, and skips the call when there's nothing new", async () => {
    const previous = { summary: "Kept.", keyPoints: ["A"], decisions: [], actionItems: [] };
    expect(await foldMeetingNotes({ previous, newSegments: [] })).toBe(previous);
    expect(createChatCompletion).not.toHaveBeenCalled();

    vi.mocked(createChatCompletion).mockRejectedValue(new Error("timeout"));
    const notes = await foldMeetingNotes({
      previous,
      newSegments: [{ speakerId: "you", startTime: 0, endTime: 1, text: "Hello" }],
    });
    expect(notes).toEqual(previous);
  });

  it("drops malformed action items from the model", async () => {
    vi.mocked(createChatCompletion).mockResolvedValue(
      JSON.stringify({ summary: "s", keyPoints: ["k", 3], decisions: null, actionItems: [{ action: "" }, "bad", { action: "Ship", owner: "" }] }),
    );
    const notes = await summarizeMeeting({ transcript: "We ship.", segments: [] });
    expect(notes.keyPoints).toEqual(["k"]);
    expect(notes.decisions).toEqual([]);
    expect(notes.actionItems).toEqual([{ action: "Ship", owner: undefined, deadline: undefined }]);
  });

  it("falls back to a raw excerpt if OpenAI returns unparseable JSON", async () => {
    vi.mocked(createChatCompletion).mockResolvedValue("not json");
    const notes = await summarizeMeeting({ transcript: "Quick chat about nothing much.", segments: [] });
    expect(notes.summary).toBe("Quick chat about nothing much.");
    expect(notes.actionItems).toEqual([]);
  });
});
