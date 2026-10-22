import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../corsair", () => {
  const keys = {
    get_access_token: async () => "token",
    get_expires_at: async () => String(Math.floor(Date.now() / 1000) + 3600),
    get_refresh_token: async () => "refresh",
    get_integration_credentials: async () => ({ client_id: "id", client_secret: "secret" }),
    set_access_token: async () => {},
    set_expires_at: async () => {},
  };
  return {
    getCorsair: () => ({ withTenant: () => new Proxy({}, { get: () => ({ api: {}, keys }) }) }),
    getCorsairCalendarRedirectUri: () => "http://localhost/cb",
    isCorsairConfigured: () => true,
  };
});

import { CorsairWorkspaceService, formQuestionBody, toClassroomDue } from "./workspace";

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let respond: (call: Call) => unknown = () => ({});

beforeEach(() => {
  calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    };
    calls.push(call);
    const body = respond(call) ?? {};
    if (typeof body === "string") return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formsCreate", () => {
  it("creates, enables quiz mode before graded items, publishes, then reads the real responder link", async () => {
    respond = (call) => {
      if (call.url.endsWith("/v1/forms") && call.method === "POST") return { formId: "F1" };
      if (call.url.includes("fields=responderUri")) {
        return {
          responderUri: "https://docs.google.com/forms/d/e/1FAIpQLSreal/viewform",
          publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } },
        };
      }
      return {};
    };

    const ws = new CorsairWorkspaceService();
    const form = await ws.formsCreate("u1", {
      title: "Capitals quiz",
      isQuiz: true,
      questions: [
        { title: "Capital of France?", type: "multiple_choice", options: ["Paris", "Rome"], points: 2, correctAnswers: ["Paris"] },
        { title: "Why?", type: "paragraph", points: 5 },
      ],
    });

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /v1/forms",
      "POST /v1/forms/F1:batchUpdate",
      "POST /v1/forms/F1:setPublishSettings",
      "GET /v1/forms/F1",
    ]);

    const requests = calls[1]!.body!.requests as Array<Record<string, unknown>>;
    expect(Object.keys(requests[0]!)).toEqual(["updateSettings"]);
    expect(requests[1]).toMatchObject({
      createItem: {
        item: {
          questionItem: {
            question: { grading: { pointValue: 2, correctAnswers: { answers: [{ value: "Paris" }] } } },
          },
        },
      },
    });
    // Paragraphs can't be auto-graded; sending grading would make Forms reject the batch.
    expect(JSON.stringify(requests[2])).not.toContain("grading");

    expect(calls[2]!.body).toEqual({
      publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } },
      updateMask: "publishState",
    });
    expect(form).toEqual({
      formId: "F1",
      url: "https://docs.google.com/forms/d/F1/edit",
      responderUrl: "https://docs.google.com/forms/d/e/1FAIpQLSreal/viewform",
      published: true,
    });
  });

  it("reports an unpublished form instead of pretending it is live", async () => {
    respond = (call) => {
      if (call.url.endsWith("/v1/forms") && call.method === "POST") return { formId: "F2" };
      if (call.url.includes("fields=responderUri")) {
        return { responderUri: "r", publishSettings: { publishState: { isPublished: false, isAcceptingResponses: false } } };
      }
      return {};
    };
    const form = await new CorsairWorkspaceService().formsCreate("u1", {
      title: "T",
      questions: [{ title: "Q", type: "short_answer" }],
    });
    expect(form.published).toBe(false);
  });
});

describe("driveReadFileText", () => {
  it("exports Google Sheets as CSV through Drive instead of downloading", async () => {
    respond = (call) => {
      if (call.url.includes("/export?")) return "a,b\n1,2";
      return { id: "S1", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet", webViewLink: "https://docs.google.com/spreadsheets/d/S1/edit" };
    };
    const file = await new CorsairWorkspaceService().driveReadFileText("u1", { fileId: "S1" });
    expect(calls[1]!.url).toContain("/files/S1/export?mimeType=text%2Fcsv");
    expect(file).toMatchObject({ name: "Budget", url: "https://docs.google.com/spreadsheets/d/S1/edit", text: "a,b\n1,2" });
  });

  it("refuses binary files it can't read instead of returning garbage", async () => {
    respond = () => ({ id: "I1", name: "photo.png", mimeType: "image/png" });
    const file = await new CorsairWorkspaceService().driveReadFileText("u1", { fileId: "I1" });
    expect(file.unreadable).toMatch(/image\/png/);
    expect(calls).toHaveLength(1);
  });

  it("refuses files over the size cap before downloading", async () => {
    respond = () => ({ id: "P1", name: "big.pdf", mimeType: "application/pdf", size: String(40 * 1024 * 1024) });
    const file = await new CorsairWorkspaceService().driveReadFileText("u1", { fileId: "P1" });
    expect(file.unreadable).toMatch(/too large/);
    expect(calls).toHaveLength(1);
  });
});

describe("formsAddQuestions", () => {
  it("appends after existing items and never touches publish state", async () => {
    respond = (call) =>
      call.url.endsWith("/v1/forms/F1") ? { items: [{}, {}, {}], settings: { quizSettings: { isQuiz: false } } } : {};
    await new CorsairWorkspaceService().formsAddQuestions("u1", {
      formId: "F1",
      questions: [{ title: "Diet?", type: "short_answer" }],
    });
    expect(calls.some((c) => c.url.includes("setPublishSettings"))).toBe(false);
    const batch = calls.find((c) => c.url.includes(":batchUpdate"))!;
    expect(batch.body).toMatchObject({ requests: [{ createItem: { location: { index: 3 } } }] });
  });
});

describe("formQuestionBody", () => {
  it("omits grading outside quiz mode", () => {
    expect(formQuestionBody({ title: "Q", type: "short_answer", points: 3 }, false)).not.toHaveProperty("grading");
  });

  it("maps choice types to Forms enums", () => {
    expect(formQuestionBody({ title: "Q", type: "dropdown", options: ["a", "b"] })).toMatchObject({
      choiceQuestion: { type: "DROP_DOWN", options: [{ value: "a" }, { value: "b" }] },
    });
  });
});

describe("toClassroomDue", () => {
  it("converts an offset date-time to UTC parts", () => {
    expect(toClassroomDue("2026-10-25T23:59:00+05:30")).toEqual({
      dueDate: { year: 2026, month: 10, day: 25 },
      dueTime: { hours: 18, minutes: 29 },
    });
  });

  it("rolls over the UTC date when needed", () => {
    expect(toClassroomDue("2026-10-25T02:00:00+05:30").dueDate).toEqual({ year: 2026, month: 10, day: 24 });
  });

  it("treats a bare date as 23:59 UTC", () => {
    expect(toClassroomDue("2026-10-25")).toEqual({
      dueDate: { year: 2026, month: 10, day: 25 },
      dueTime: { hours: 23, minutes: 59 },
    });
  });
});

describe("classroomListSubmissions", () => {
  it("joins submissions with the roster and follows pagination", async () => {
    respond = (call) => {
      if (call.url.includes("/studentSubmissions")) {
        return call.url.includes("pageToken=p2")
          ? { studentSubmissions: [{ userId: "s2", state: "CREATED", late: false }] }
          : { studentSubmissions: [{ userId: "s1", state: "TURNED_IN", late: true, assignedGrade: 9 }], nextPageToken: "p2" };
      }
      if (call.url.includes("/students")) {
        return {
          students: [
            { userId: "s1", profile: { name: { fullName: "Asha" }, emailAddress: "asha@school.edu" } },
            { userId: "s2", profile: { name: { fullName: "Ravi" } } },
          ],
        };
      }
      return {};
    };
    const subs = await new CorsairWorkspaceService().classroomListSubmissions("u1", { courseId: "c1", courseWorkId: "w1" });
    expect(subs).toEqual([
      { studentName: "Asha", studentEmail: "asha@school.edu", state: "TURNED_IN", late: true, assignedGrade: 9 },
      { studentName: "Ravi", studentEmail: undefined, state: "CREATED", late: false, assignedGrade: undefined },
    ]);
  });
});
