import { describe, expect, it, vi } from "vitest";
import type { WorkspaceService } from "@repo/services/workspace";
import type { WorkspaceActionPayload } from "@repo/services/workspace/schemas";

import { executeWorkspaceAction } from "./workspace-actions";

function fakeWorkspace(overrides: Partial<WorkspaceService> = {}) {
  let n = 0;
  return {
    getConnectionStatus: vi.fn(async () => ({
      googledrive: "connected",
      googlesheets: "connected",
      googlemeet: "connected",
      googleforms: "connected",
      googleslides: "connected",
      googleclassroom: "connected",
    })),
    driveFindFolderByName: vi.fn(async () => null),
    driveCreateFolder: vi.fn(async (_t: string, input: { name: string }) => ({ id: "folder1", name: input.name, isFolder: true })),
    readGmailAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
    readStagedUpload: vi.fn(async () => null),
    driveUploadFile: vi.fn(async (_t: string, input: { name: string }) => ({
      id: `file${++n}`,
      name: input.name,
      isFolder: false,
    })),
    ...overrides,
  } as unknown as WorkspaceService;
}

const twoFiles: WorkspaceActionPayload = {
  action: "drive_save_files",
  folderName: "Q3",
  files: [
    { type: "gmail_attachment", messageId: "m", attachmentId: "a1", filename: "one.pdf", mimeType: "application/pdf" },
    { type: "gmail_attachment", messageId: "m", attachmentId: "a2", filename: "two.pdf", mimeType: "application/pdf" },
  ],
};

describe("executeWorkspaceAction", () => {
  it("creates the folder when missing and uploads every file into it", async () => {
    const ws = fakeWorkspace();
    const result = await executeWorkspaceAction(ws, "u1", twoFiles, vi.fn());
    expect(ws.driveCreateFolder).toHaveBeenCalledWith("u1", { name: "Q3" });
    expect(ws.driveUploadFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ws.driveUploadFile).mock.calls[0]?.[1]).toMatchObject({ parentId: "folder1" });
    expect(result.links?.map((l) => l.label)).toEqual(["one.pdf", "two.pdf"]);
  });

  it("reuses an existing folder with the same name", async () => {
    const ws = fakeWorkspace({
      driveFindFolderByName: vi.fn(async () => ({ id: "existing", name: "Q3", isFolder: true })),
    });
    await executeWorkspaceAction(ws, "u1", twoFiles, vi.fn());
    expect(ws.driveCreateFolder).not.toHaveBeenCalled();
    expect(vi.mocked(ws.driveUploadFile).mock.calls[0]?.[1]).toMatchObject({ parentId: "existing" });
  });

  it("saves progress on partial failure and skips finished files on retry", async () => {
    let fail = true;
    const ws = fakeWorkspace({
      readGmailAttachment: vi.fn(async (_t: string, input: { attachmentId: string }) => {
        if (input.attachmentId === "a2" && fail) throw new Error("timeout");
        return new Uint8Array([1]);
      }),
    });
    const saveProgress = vi.fn();
    await expect(executeWorkspaceAction(ws, "u1", twoFiles, saveProgress)).rejects.toThrow(/two\.pdf: timeout.*1 file\(s\) already saved/);
    const completed = saveProgress.mock.calls[0]?.[0];
    expect(completed).toEqual([{ key: "gmail:m:a1", name: "one.pdf", url: expect.any(String) }]);

    fail = false;
    vi.mocked(ws.driveUploadFile).mockClear();
    const result = await executeWorkspaceAction(ws, "u1", { ...twoFiles, completed }, saveProgress);
    expect(ws.driveUploadFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ws.driveUploadFile).mock.calls[0]?.[1]).toMatchObject({ name: "two.pdf" });
    expect(result.links).toHaveLength(2);
  });

  it("fails clearly when an attached chat file expired", async () => {
    const ws = fakeWorkspace();
    await expect(
      executeWorkspaceAction(
        ws,
        "u1",
        {
          action: "drive_save_files",
          files: [{ type: "upload", uploadId: "22222222-2222-4222-8222-222222222222", filename: "x.png", mimeType: "image/png" }],
        },
        vi.fn(),
      ),
    ).rejects.toThrow(/expired/);
  });

  it("blocks with a connect message when a required app is disconnected", async () => {
    const ws = fakeWorkspace({
      getConnectionStatus: vi.fn(async () => ({
        googledrive: "not_connected" as const,
        googlesheets: "connected" as const,
        googlemeet: "connected" as const,
        googleforms: "connected" as const,
        googleslides: "connected" as const,
        googleclassroom: "connected" as const,
      })),
    });
    await expect(executeWorkspaceAction(ws, "u1", twoFiles, vi.fn())).rejects.toThrow(/Connect Google Drive/);
    expect(ws.driveUploadFile).not.toHaveBeenCalled();
  });

  it("creates a form and returns the real responder link", async () => {
    const ws = fakeWorkspace({
      formsCreate: vi.fn(async () => ({
        formId: "f1",
        url: "https://docs.google.com/forms/d/f1/edit",
        responderUrl: "https://docs.google.com/forms/d/e/1FAIpQLSf/viewform",
        published: true,
      })),
    });
    const result = await executeWorkspaceAction(
      ws,
      "u1",
      { action: "forms_create", title: "RSVP", isQuiz: true, questions: [{ title: "Name", type: "short_answer" }] },
      vi.fn(),
    );
    expect(result.url).toBe("https://docs.google.com/forms/d/f1/edit");
    expect(result.label).toBe("Open RSVP");
    expect(result.links).toEqual([
      { label: "Link to share with responders", url: "https://docs.google.com/forms/d/e/1FAIpQLSf/viewform" },
    ]);
    expect(vi.mocked(ws.formsCreate).mock.calls[0]?.[1]).toMatchObject({ isQuiz: true });
  });

  it("warns when the form could not be published", async () => {
    const ws = fakeWorkspace({
      formsCreate: vi.fn(async () => ({ formId: "f1", url: "u", published: false })),
    });
    const result = await executeWorkspaceAction(
      ws,
      "u1",
      { action: "forms_create", title: "RSVP", questions: [{ title: "Name", type: "short_answer" }] },
      vi.fn(),
    );
    expect(result.label).toMatch(/not accepting responses/);
    expect(result.links).toEqual([]);
  });

  it("adds questions to an existing form", async () => {
    const ws = fakeWorkspace({
      formsAddQuestions: vi.fn(async () => ({ formId: "f1", url: "u", responderUrl: "r", published: true })),
    });
    await executeWorkspaceAction(
      ws,
      "u1",
      { action: "forms_add_questions", formId: "f1", questions: [{ title: "Diet?", type: "short_answer" }] },
      vi.fn(),
    );
    expect(ws.formsAddQuestions).toHaveBeenCalledWith("u1", { formId: "f1", questions: [{ title: "Diet?", type: "short_answer" }] });
  });

  it("creates a Classroom assignment", async () => {
    const ws = fakeWorkspace({
      classroomCreateCourseWork: vi.fn(async () => ({ id: "w1", url: "https://classroom.google.com/c/x/a/w1" })),
    });
    const result = await executeWorkspaceAction(
      ws,
      "u1",
      { action: "classroom_create_coursework", courseId: "c1", courseName: "Algebra", title: "HW 4", dueDate: "2026-10-25T23:59:00+05:30" },
      vi.fn(),
    );
    expect(ws.classroomCreateCourseWork).toHaveBeenCalledWith("u1", {
      courseId: "c1",
      title: "HW 4",
      description: undefined,
      dueDate: "2026-10-25T23:59:00+05:30",
      maxPoints: undefined,
    });
    expect(result.url).toBe("https://classroom.google.com/c/x/a/w1");
  });

  it("creates a form inside a resolved folder", async () => {
    const ws = fakeWorkspace({
      formsCreate: vi.fn(async () => ({ formId: "f1", url: "u", responderUrl: "r", published: true })),
    });
    await executeWorkspaceAction(
      ws,
      "u1",
      { action: "forms_create", title: "RSVP", folderName: "Events", questions: [{ title: "Name", type: "short_answer" }] },
      vi.fn(),
    );
    expect(ws.driveCreateFolder).toHaveBeenCalledWith("u1", { name: "Events" });
    expect(vi.mocked(ws.formsCreate).mock.calls[0]?.[1]).toMatchObject({ folderId: "folder1" });
  });

  it("creates a presentation from an outline", async () => {
    const ws = fakeWorkspace({
      slidesCreate: vi.fn(async () => ({ presentationId: "p1", url: "https://docs.google.com/presentation/d/p1/edit" })),
    });
    const result = await executeWorkspaceAction(
      ws,
      "u1",
      { action: "slides_create", title: "Weekly update", outline: [{ title: "Highlights", bullets: ["A"] }] },
      vi.fn(),
    );
    expect(result.url).toBe("https://docs.google.com/presentation/d/p1/edit");
    expect(ws.slidesCreate).toHaveBeenCalledWith("u1", { title: "Weekly update", outline: [{ title: "Highlights", bullets: ["A"] }], folderId: undefined });
  });

  it("posts a classroom announcement", async () => {
    const ws = fakeWorkspace({ classroomPostAnnouncement: vi.fn(async () => ({ id: "a1" })) });
    const result = await executeWorkspaceAction(
      ws,
      "u1",
      { action: "classroom_post_announcement", courseId: "c1", courseName: "Algebra", text: "Quiz moved" },
      vi.fn(),
    );
    expect(ws.classroomPostAnnouncement).toHaveBeenCalledWith("u1", { courseId: "c1", text: "Quiz moved" });
    expect(result.label).toBe("Posted to Algebra");
  });
});
