import { describe, expect, it, vi } from "vitest";

import { registerMeetingService, type MeetingService } from "../meetings";
import type { QueueItem, QueueService } from "../queue";
import type { WorkspaceConnectionStatus, WorkspaceService } from "./index";
import { executeWorkspaceTool, extractGoogleFileId } from "./tools";

const allConnected: WorkspaceConnectionStatus = {
  googledrive: "connected",
  googlesheets: "connected",
  googlemeet: "connected",
  googleforms: "connected",
  googleslides: "connected",
  googleclassroom: "connected",
};

function fakes(status: WorkspaceConnectionStatus = allConnected) {
  const enqueued: Array<{ payload: unknown; title?: string }> = [];
  const queue = {
    enqueueWorkspaceAction: vi.fn(async (_userId: string, input: { payload: unknown; title?: string }) => {
      enqueued.push(input);
      return {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "workspace_action",
        title: input.title ?? "",
        payload: input.payload as Record<string, unknown>,
        status: "pending",
        createdAt: new Date().toISOString(),
      } satisfies QueueItem;
    }),
  } as unknown as QueueService;
  const workspace = {
    getConnectionStatus: vi.fn(async () => status),
    getStagedUploadMeta: vi.fn(async (_t: string, id: string) =>
      id === "22222222-2222-4222-8222-222222222222"
        ? { id, filename: "receipt.pdf", mimeType: "application/pdf", size: 10 }
        : null,
    ),
    driveListFiles: vi.fn(async () => [{ id: "f1", name: "Invoices", isFolder: true }]),
    formsGetResponses: vi.fn(async () => ({
      responses: [{ responseId: "r1", answers: [{ question: "Name?", answer: "Priya" }] }],
      truncated: false,
    })),
    slidesReadText: vi.fn(async () => ({ title: "Deck", text: "Slide 1:\nHello" })),
    driveReadFileText: vi.fn(async (_t: string, input: { fileId: string }) =>
      input.fileId === "1ScanPdfAbcdef"
        ? { id: input.fileId, name: "scan.pdf", url: "u", text: "", truncated: false, unreadable: "no text layer" }
        : { id: input.fileId, name: "Resume.pdf", mimeType: "application/pdf", url: "https://drive.google.com/file/d/x/view", text: "Ishaan — engineer", truncated: false },
    ),
    classroomListCourses: vi.fn(async () => [{ id: "c1", name: "Algebra" }]),
    classroomListCourseWork: vi.fn(async () => [{ id: "w1", title: "Homework 1" }]),
    classroomListAnnouncements: vi.fn(async () => [{ id: "a1", text: "Class moved to room 2" }]),
    classroomListDueWork: vi.fn(async () => [
      { id: "w1", title: "Essay", courseId: "c1", courseName: "English", dueDate: "2026-10-24", mySubmissionState: "CREATED" },
    ]),
    classroomListSubmissions: vi.fn(async () => [
      { studentName: "Asha", state: "TURNED_IN", late: false },
      { studentName: "Ravi", state: "CREATED", late: false },
      { studentName: "Meera", state: "TURNED_IN", late: true },
    ]),
  } as unknown as WorkspaceService;
  return { queue, workspace, enqueued, ctx: { tenantId: "u1", queue, workspace, origin: "agent" as const } };
}

describe("executeWorkspaceTool", () => {
  it("returns null for tools it does not own", async () => {
    const { ctx } = fakes();
    expect(await executeWorkspaceTool("list_inbox", {}, ctx)).toBeNull();
  });

  it("queues a Gmail attachment + chat upload save into a named folder", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool(
      "queue_drive_save_files",
      {
        gmailAttachments: [
          { messageId: "m1", attachmentId: "a1", filename: "[EMAIL_DATA_START]Q3.pdf[EMAIL_DATA_END]", mimeType: "application/pdf" },
        ],
        uploadIds: ["22222222-2222-4222-8222-222222222222"],
        folderName: "Q3 Contracts",
      },
      ctx,
    );
    expect(out?.card).toMatchObject({ kind: "workspace_queued", disposition: "queued" });
    expect(enqueued[0]?.payload).toMatchObject({
      action: "drive_save_files",
      folderName: "Q3 Contracts",
      files: [
        { type: "gmail_attachment", messageId: "m1", attachmentId: "a1", filename: "Q3.pdf" },
        { type: "upload", uploadId: "22222222-2222-4222-8222-222222222222", filename: "receipt.pdf" },
      ],
    });
  });

  it("refuses unknown or expired chat uploads instead of queueing", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool(
      "queue_drive_save_files",
      { uploadIds: ["33333333-3333-4333-8333-333333333333"] },
      ctx,
    );
    expect(out?.result).toMatchObject({ error: expect.stringContaining("expired") });
    expect(enqueued).toHaveLength(0);
  });

  it("reports which app to connect when the plugin is missing", async () => {
    const { ctx, enqueued } = fakes({ ...allConnected, googlesheets: "not_connected" });
    const out = await executeWorkspaceTool("queue_sheet_create", { title: "Budget", rows: [["a"]] }, ctx);
    expect(out?.result).toMatchObject({ notConnected: ["googlesheets"] });
    expect(enqueued).toHaveLength(0);
  });

  it("runs Google Docs on the Drive connection", async () => {
    const { ctx, enqueued } = fakes({ ...allConnected, googledrive: "not_connected" });
    const out = await executeWorkspaceTool("queue_doc_create", { title: "Notes", markdown: "# Hi" }, ctx);
    expect(out?.result).toMatchObject({ notConnected: ["googledrive"] });
    expect(enqueued).toHaveLength(0);
  });

  it("needs Drive too when a sheet goes into a folder", async () => {
    const { ctx } = fakes({ ...allConnected, googledrive: "not_connected" });
    const out = await executeWorkspaceTool("queue_sheet_create", { title: "Budget", folderName: "Finance" }, ctx);
    expect(out?.result).toMatchObject({ notConnected: ["googledrive"] });
  });

  it("coerces model rows to strings and accepts sheet URLs as ids", async () => {
    const { ctx, enqueued } = fakes();
    await executeWorkspaceTool(
      "queue_sheet_append_rows",
      {
        spreadsheetId: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0",
        rows: [[1, null, "x"], "not-a-row"],
      },
      ctx,
    );
    expect(enqueued[0]?.payload).toMatchObject({
      spreadsheetId: "1AbCdEfGhIjKlMnOp",
      rows: [["1", "", "x"]],
    });
  });

  it("returns validation issues instead of throwing on bad input", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("queue_drive_share_file", { fileId: "f", fileName: "x", email: "nope" }, ctx);
    expect(out?.result).toMatchObject({ error: "Invalid arguments" });
  });

  it("requires a destination for moves", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("queue_drive_move_file", { fileId: "f", fileName: "x" }, ctx);
    expect(out?.result).toMatchObject({ error: expect.stringContaining("folderId or folderName") });
  });

  it("fences Drive names returned to the model", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("search_drive", { query: "Inv" }, ctx);
    const files = (out?.result as { files: Array<{ name: string }> }).files;
    expect(files[0]?.name).toContain("[EMAIL_DATA_START]");
  });

  it("queues a form with mapped question types", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool(
      "queue_form_create",
      {
        title: "RSVP",
        questions: [
          { title: "Name", type: "short_answer" },
          { title: "Attending?", type: "multiple_choice", options: ["Yes", "No"] },
        ],
      },
      ctx,
    );
    expect(out?.card).toMatchObject({ kind: "workspace_queued", disposition: "queued" });
    expect(enqueued[0]?.payload).toMatchObject({
      action: "forms_create",
      title: "RSVP",
      questions: [
        { title: "Name", type: "short_answer" },
        { title: "Attending?", type: "multiple_choice", options: ["Yes", "No"] },
      ],
    });
  });

  it("reports which app to connect for Forms", async () => {
    const { ctx, enqueued } = fakes({ ...allConnected, googleforms: "not_connected" });
    const out = await executeWorkspaceTool("queue_form_create", { title: "X", questions: [{ title: "Q", type: "short_answer" }] }, ctx);
    expect(out?.result).toMatchObject({ notConnected: ["googleforms"] });
    expect(enqueued).toHaveLength(0);
  });

  it("fences form response answers returned to the model", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("get_form_responses", { formId: "f1" }, ctx);
    const responses = (out?.result as { responses: Array<{ answers: Array<{ question: string; answer: string }> }> }).responses;
    expect(responses[0]?.answers[0]?.question).toContain("[EMAIL_DATA_START]");
  });

  it("queues a slide deck outline", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool(
      "queue_slides_create",
      { title: "Weekly update", outline: [{ title: "Highlights", bullets: ["Shipped X", "Fixed Y"] }] },
      ctx,
    );
    expect(out?.card).toMatchObject({ kind: "workspace_queued", disposition: "queued" });
    expect(enqueued[0]?.payload).toMatchObject({
      action: "slides_create",
      outline: [{ title: "Highlights", bullets: ["Shipped X", "Fixed Y"] }],
    });
  });

  it("fences presentation text returned to the model", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("read_presentation", { presentationId: "p1" }, ctx);
    expect((out?.result as { text: string }).text).toContain("[EMAIL_DATA_START]");
  });

  it("reads any Drive file from a pasted share link and fences its text", async () => {
    const { ctx, workspace } = fakes();
    const out = await executeWorkspaceTool(
      "read_drive_file",
      { fileId: "https://drive.google.com/file/d/1OFCNDMqn9ERvrq/view?usp=drivesdk" },
      ctx,
    );
    expect(workspace.driveReadFileText).toHaveBeenCalledWith("u1", { fileId: "1OFCNDMqn9ERvrq", maxChars: 20_000 });
    expect(out?.result).toMatchObject({ url: "https://drive.google.com/file/d/x/view" });
    expect((out?.result as { text: string }).text).toContain("[EMAIL_DATA_START]");
  });

  it("passes through why a file can't be read instead of returning empty text", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("read_drive_file", { fileId: "1ScanPdfAbcdef" }, ctx);
    expect(out?.result).toMatchObject({ unreadable: "no text layer" });
    expect(out?.result).not.toHaveProperty("text");
  });

  it("accepts open?id= style Drive links", () => {
    expect(extractGoogleFileId("https://drive.google.com/open?id=1AbCdEfGhIjKl")).toBe("1AbCdEfGhIjKl");
  });

  it("lists classroom courses, coursework and announcements", async () => {
    const { ctx } = fakes();
    const courses = await executeWorkspaceTool("list_classroom_courses", {}, ctx);
    expect(courses?.result).toMatchObject({ count: 1, courses: [{ id: "c1", name: "Algebra" }] });

    const coursework = await executeWorkspaceTool("list_classroom_coursework", { courseId: "c1" }, ctx);
    expect((coursework?.result as { count: number }).count).toBe(1);

    const announcements = await executeWorkspaceTool("list_classroom_announcements", { courseId: "c1" }, ctx);
    expect((announcements?.result as { count: number }).count).toBe(1);
  });

  it("queues a graded quiz with an answer key", async () => {
    const { ctx, enqueued } = fakes();
    await executeWorkspaceTool(
      "queue_form_create",
      {
        title: "Capitals",
        isQuiz: true,
        questions: [{ title: "France?", type: "multiple_choice", options: ["Paris", "Rome"], points: "2", correctAnswers: ["Paris"] }],
      },
      ctx,
    );
    expect(enqueued[0]?.payload).toMatchObject({
      isQuiz: true,
      questions: [{ points: 2, correctAnswers: ["Paris"] }],
    });
  });

  it("rejects a choice question with fewer than two options", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool(
      "queue_form_create",
      { title: "X", questions: [{ title: "Pick", type: "multiple_choice", options: ["Only one"] }] },
      ctx,
    );
    expect(out?.result).toMatchObject({ error: "Invalid arguments" });
    expect(enqueued).toHaveLength(0);
  });

  it("rejects an answer key that isn't one of the options", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool(
      "queue_form_create",
      { title: "X", isQuiz: true, questions: [{ title: "Pick", type: "multiple_choice", options: ["A", "B"], correctAnswers: ["C"] }] },
      ctx,
    );
    expect(JSON.stringify(out?.result)).toContain("not among options: C");
  });

  it("queues adding questions to a form given its URL", async () => {
    const { ctx, enqueued } = fakes();
    await executeWorkspaceTool(
      "queue_form_add_questions",
      { formId: "https://docs.google.com/forms/d/1FormIdAbcdefgh/edit", questions: [{ title: "Diet?", type: "short_answer" }] },
      ctx,
    );
    expect(enqueued[0]?.payload).toMatchObject({ action: "forms_add_questions", formId: "1FormIdAbcdefgh" });
  });

  it("lists due work across courses with fenced titles", async () => {
    const { ctx, workspace } = fakes();
    const out = await executeWorkspaceTool("list_classroom_due_work", { withinDays: 500 }, ctx);
    expect(workspace.classroomListDueWork).toHaveBeenCalledWith("u1", { withinDays: 60 });
    const work = (out?.result as { work: Array<{ title: string; mySubmissionState: string }> }).work;
    expect(work[0]?.title).toContain("[EMAIL_DATA_START]");
    expect(work[0]?.mySubmissionState).toBe("CREATED");
  });

  it("summarises who turned in, who is missing and who was late", async () => {
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("list_classroom_submissions", { courseId: "c1", courseWorkId: "w1" }, ctx);
    expect(out?.result).toMatchObject({ total: 3, turnedIn: 2, missing: 1, late: 1 });
  });

  it("queues a Classroom assignment and rejects an invalid due date", async () => {
    const { ctx, enqueued } = fakes();
    await executeWorkspaceTool(
      "queue_classroom_coursework_create",
      { courseId: "c1", courseName: "Algebra", title: "HW 4", dueDate: "2026-10-25T23:59:00+05:30", maxPoints: 10 },
      ctx,
    );
    expect(enqueued[0]?.payload).toMatchObject({ action: "classroom_create_coursework", maxPoints: 10 });

    const bad = await executeWorkspaceTool("queue_classroom_coursework_create", { courseId: "c1", title: "HW", dueDate: "next friday" }, ctx);
    expect(bad?.result).toMatchObject({ error: "Invalid arguments" });
  });

  it("strips stock filler from announcement text", async () => {
    const { ctx, enqueued } = fakes();
    await executeWorkspaceTool(
      "queue_classroom_announcement",
      { courseId: "c1", text: "I hope this email finds you well. Quiz moved to Friday." },
      ctx,
    );
    expect(enqueued[0]?.payload).toMatchObject({ text: "Quiz moved to Friday." });
  });

  it("queues a classroom announcement", async () => {
    const { ctx, enqueued } = fakes();
    const out = await executeWorkspaceTool("queue_classroom_announcement", { courseId: "c1", courseName: "Algebra", text: "Quiz moved" }, ctx);
    expect(out?.card).toMatchObject({ kind: "workspace_queued", disposition: "queued" });
    expect(enqueued[0]?.payload).toMatchObject({ action: "classroom_post_announcement", courseId: "c1", text: "Quiz moved" });
  });
});

describe("meeting tools", () => {
  const meeting = {
    id: "m1",
    title: "Pricing review",
    mode: "live" as const,
    status: "ready" as const,
    meetUrl: "https://meet.google.com/abc-defg-hij",
    languageCode: "en-IN",
    segmentCount: 3,
    durationSeconds: 125,
    summary: "Price stays at 499.",
    createdAt: "2026-10-23T10:00:00.000Z",
    endedAt: "2026-10-23T10:02:05.000Z",
    segments: [
      { speakerId: "meeting", startTime: 3, endTime: 6, text: "What about the budget for Q3?" },
      { speakerId: "you", startTime: 70, endTime: 74, text: "Budget is approved at 20 lakh." },
      { speakerId: "meeting", startTime: 80, endTime: 82, text: "Great, ship Friday." },
    ],
    notes: { summary: "Price stays at 499.", keyPoints: [], decisions: ["Ship Friday"], actionItems: [] },
    summarizedCount: 3,
    errorMessage: null,
  };

  const service = {
    isTranscriptionConfigured: () => true,
    list: vi.fn(async () => [meeting]),
    get: vi.fn(async () => meeting),
  } as unknown as MeetingService;

  it("lists meetings with fenced titles and a room link", async () => {
    registerMeetingService(service);
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("list_meetings", {}, ctx);
    const result = out?.result as { count: number; meetings: Array<{ title: string; minutes: number; url: string }> };
    expect(result.count).toBe(1);
    expect(result.meetings[0]?.title).toContain("[EMAIL_DATA_START]");
    expect(result.meetings[0]).toMatchObject({ minutes: 2, url: "/meet/m1" });
  });

  it("finds what was said about a topic, with speaker and timestamp", async () => {
    registerMeetingService(service);
    const { ctx } = fakes();
    const out = await executeWorkspaceTool("get_meeting", { query: "budget" }, ctx);
    const result = out?.result as { matchCount: number; matches: string };
    expect(service.list).toHaveBeenCalled(); // no meetingId → most recent meeting
    expect(result.matchCount).toBe(2);
    expect(result.matches).toContain("[1:10] You: Budget is approved at 20 lakh.");
    expect(result.matches).not.toContain("ship Friday");
    expect(out?.card).toMatchObject({ kind: "workspace", href: "/meet/m1" });
  });
});

describe("extractGoogleFileId", () => {
  it("handles bare ids and doc/sheet URLs", () => {
    expect(extractGoogleFileId("abc")).toBe("abc");
    expect(extractGoogleFileId("https://docs.google.com/document/d/1xYz_abc-123456/edit")).toBe("1xYz_abc-123456");
  });
});
