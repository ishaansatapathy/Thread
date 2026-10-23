import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchJobTranscript,
  getJobStatus,
  isGnaniConfigured,
  isTerminalGnaniStatus,
  normalizeGnaniLanguage,
  submitMeetingAudio,
  transcribeClip,
} from "./gnani";

type Call = { url: string; method: string; headers?: Record<string, string> };
let calls: Call[] = [];
let respond: (call: Call) => unknown = () => ({});

beforeEach(() => {
  calls = [];
  process.env.GNANI_API_KEY = "test-key";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string> | undefined,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call) ?? {}), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GNANI_API_KEY;
});

describe("isGnaniConfigured", () => {
  it("is false without an API key", () => {
    delete process.env.GNANI_API_KEY;
    expect(isGnaniConfigured()).toBe(false);
  });

  it("is true once GNANI_API_KEY is set", () => {
    expect(isGnaniConfigured()).toBe(true);
  });
});

describe("isTerminalGnaniStatus", () => {
  it("treats COMPLETED/FAILED/etc as terminal, IN_PROGRESS as not", () => {
    expect(isTerminalGnaniStatus("COMPLETED")).toBe(true);
    expect(isTerminalGnaniStatus("FAILED")).toBe(true);
    expect(isTerminalGnaniStatus("CANCELLED")).toBe(true);
    expect(isTerminalGnaniStatus("IN_PROGRESS")).toBe(false);
    expect(isTerminalGnaniStatus("QUEUED")).toBe(false);
  });
});

describe("submitMeetingAudio", () => {
  it("creates the job then starts it, sending the API key on both calls", async () => {
    respond = (call) => (call.url.endsWith("/batch/jobs") ? { job_id: "job_1", status: "CREATED" } : { status: "STARTING" });

    const { jobId } = await submitMeetingAudio(
      { data: Buffer.from("fake audio"), filename: "meeting.wav", mimeType: "audio/wav" },
      { languageCode: "auto" },
    );

    expect(jobId).toBe("job_1");
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /stt/v3/batch/jobs",
      "POST /stt/v3/batch/jobs/job_1/start",
    ]);
    for (const call of calls) {
      expect(call.headers?.["X-API-Key-ID"]).toBe("test-key");
    }
  });
});

describe("transcribeClip", () => {
  it("posts the clip to the synchronous REST endpoint with a supported language", async () => {
    let form: FormData | undefined;
    vi.mocked(globalThis.fetch).mockImplementationOnce(async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      form = init?.body as FormData;
      return new Response(JSON.stringify({ success: true, transcript: "  namaste,   kaise ho  " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const text = await transcribeClip({ data: Buffer.from("RIFF"), filename: "c.wav", mimeType: "audio/wav" }, "hi-IN");

    expect(text).toBe("namaste, kaise ho");
    expect(new URL(calls[0]!.url).pathname).toBe("/stt/v3");
    expect(form?.get("language_code")).toBe("hi-IN");
    expect(form?.get("format")).toBe("transcribe");
    expect(form?.get("audio_file")).toBeInstanceOf(Blob);
  });

  it("falls back to en-IN for languages Gnani doesn't list", () => {
    expect(normalizeGnaniLanguage("fr-FR")).toBe("en-IN");
    expect(normalizeGnaniLanguage(undefined)).toBe("en-IN");
    expect(normalizeGnaniLanguage("ta-IN")).toBe("ta-IN");
  });

  it("surfaces a rejected API key as a configuration problem", async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => new Response("{}", { status: 401 }));
    await expect(
      transcribeClip({ data: Buffer.from("x"), filename: "c.wav", mimeType: "audio/wav" }, "en-IN"),
    ).rejects.toThrow(/rejected the API key/);
  });
});

describe("getJobStatus", () => {
  it("reads the status field", async () => {
    respond = () => ({ status: "IN_PROGRESS" });
    expect(await getJobStatus("job_1")).toEqual({ status: "IN_PROGRESS" });
  });
});

describe("fetchJobTranscript", () => {
  it("resolves the file's transcript_url and maps diarization segments", async () => {
    respond = (call) => {
      if (call.url.includes("/files?status=COMPLETED")) {
        return { files: [{ transcript_url: "https://files.vachana.ai/t1" }] };
      }
      if (call.url === "https://files.vachana.ai/t1") {
        return {
          full_transcript: "Hello there. Sure, let's do Friday.",
          language_code: "en-IN",
          duration_seconds: 12.5,
          segments: [
            { speaker_id: 1, start_time: 0, end_time: 1.2, text: "Hello there." },
            { speaker_id: 2, start_time: 1.3, end_time: 3.0, text: "Sure, let's do Friday." },
          ],
        };
      }
      return {};
    };

    const result = await fetchJobTranscript("job_1");
    expect(result).toEqual({
      transcript: "Hello there. Sure, let's do Friday.",
      durationSeconds: 12.5,
      segments: [
        { speakerId: "1", startTime: 0, endTime: 1.2, text: "Hello there." },
        { speakerId: "2", startTime: 1.3, endTime: 3.0, text: "Sure, let's do Friday." },
      ],
    });
  });

  it("returns null when no file completed yet", async () => {
    respond = () => ({ files: [] });
    expect(await fetchJobTranscript("job_1")).toBeNull();
  });
});
