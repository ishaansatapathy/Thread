/**
 * Corsair-backed Workspace connections. Google Docs has no separate connection: the
 * Drive grant (`drive` scope) also authorises the Docs API, so Docs runs on Drive.
 */
export const WORKSPACE_PLUGINS = [
  "googledrive",
  "googlesheets",
  "googlemeet",
  "googleforms",
  "googleslides",
  "googleclassroom",
] as const;
export type WorkspacePlugin = (typeof WORKSPACE_PLUGINS)[number];

export const WORKSPACE_PLUGIN_LABELS: Record<WorkspacePlugin, string> = {
  googledrive: "Google Drive",
  googlesheets: "Google Sheets",
  googlemeet: "Google Meet",
  googleforms: "Google Forms",
  googleslides: "Google Slides",
  googleclassroom: "Google Classroom",
};

export function isWorkspacePlugin(value: string): value is WorkspacePlugin {
  return (WORKSPACE_PLUGINS as readonly string[]).includes(value);
}

export type WorkspaceConnectionState =
  | "connected"
  | "missing_credentials"
  | "not_connected"
  | "not_configured";

export type WorkspaceConnectionStatus = Record<WorkspacePlugin, WorkspaceConnectionState>;

export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  isFolder: boolean;
  webViewLink?: string;
  modifiedTime?: string;
  size?: number;
  parents?: string[];
};

export type SpreadsheetRef = { spreadsheetId: string; title?: string; url: string };
export type DocumentRef = { documentId: string; title?: string; url: string };
export type DriveFileText = {
  id: string;
  name: string;
  mimeType?: string;
  url: string;
  modifiedTime?: string;
  text: string;
  truncated: boolean;
  /** Set when the file type can't be read as text (images, videos, Office files…). */
  unreadable?: string;
};
export type MeetSpace = { meetingUri: string; meetingCode?: string; name?: string };
export type MeetConference = {
  name: string;
  spaceName?: string;
  startTime?: string;
  endTime?: string;
};
export type MeetTranscript = {
  conferenceRecord: string;
  entries: Array<{ speaker?: string; text: string; startTime?: string }>;
  text: string;
  truncated: boolean;
};

export type StagedUploadMeta = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type DriveRole = "reader" | "commenter" | "writer";

export type FormRef = { formId: string; url: string; responderUrl?: string; published: boolean };
export type FormQuestionType = "short_answer" | "paragraph" | "multiple_choice" | "checkboxes" | "dropdown";
export type FormQuestion = {
  title: string;
  type: FormQuestionType;
  options?: string[];
  required?: boolean;
  /** Quiz only: points for a correct answer. */
  points?: number;
  /** Quiz only: answer key (option values, or accepted text for short answers). */
  correctAnswers?: string[];
};
export type FormResponseAnswer = { question: string; answer: string };
export type FormResponse = { responseId: string; submittedAt?: string; answers: FormResponseAnswer[] };

export type SlideOutlineSlide = { title: string; bullets: string[] };
export type PresentationRef = { presentationId: string; url: string };

export type ClassroomCourse = { id: string; name: string; section?: string; courseState?: string };
export type ClassroomCourseWork = {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  workType?: string;
  state?: string;
};
export type ClassroomAnnouncement = { id: string; text: string; creationTime?: string };
export type ClassroomDueWork = ClassroomCourseWork & {
  courseId: string;
  courseName: string;
  /** The signed-in user's own submission state when they are a student in the course. */
  mySubmissionState?: string;
  late?: boolean;
};
export type ClassroomSubmission = {
  studentName: string;
  studentEmail?: string;
  state: string;
  late: boolean;
  assignedGrade?: number;
};

export interface WorkspaceService {
  getConnectionStatus(tenantId: string): Promise<WorkspaceConnectionStatus>;
  disconnect(tenantId: string, plugin: WorkspacePlugin): Promise<void>;

  driveListFiles(
    tenantId: string,
    opts: { query?: string; folderId?: string; foldersOnly?: boolean; mimeType?: string; maxResults?: number },
  ): Promise<DriveFile[]>;
  driveFindFolderByName(tenantId: string, name: string, parentId?: string): Promise<DriveFile | null>;
  driveCreateFolder(tenantId: string, input: { name: string; parentId?: string }): Promise<DriveFile>;
  driveUploadFile(
    tenantId: string,
    input: { name: string; mimeType: string; data: Uint8Array; parentId?: string },
  ): Promise<DriveFile>;
  driveMoveFile(tenantId: string, input: { fileId: string; folderId: string }): Promise<DriveFile>;
  driveShareFile(
    tenantId: string,
    input: { fileId: string; email: string; role: DriveRole; notify: boolean; message?: string },
  ): Promise<void>;

  sheetsCreate(
    tenantId: string,
    input: { title: string; rows?: string[][]; folderId?: string },
  ): Promise<SpreadsheetRef>;
  sheetsAppendRows(
    tenantId: string,
    input: { spreadsheetId: string; sheetName?: string; rows: string[][] },
  ): Promise<{ updatedRows: number; url: string }>;
  sheetsReadRows(
    tenantId: string,
    input: { spreadsheetId: string; sheetName?: string; range?: string; maxRows?: number },
  ): Promise<{ rows: string[][]; truncated: boolean }>;

  docsCreate(
    tenantId: string,
    input: { title: string; markdown: string; folderId?: string },
  ): Promise<DocumentRef>;
  docsReadText(
    tenantId: string,
    input: { documentId: string; maxChars?: number },
  ): Promise<{ title?: string; text: string; truncated: boolean }>;
  /** Text of any Drive file: Google Docs/Sheets/Slides via export, PDFs and plain-text files via download. */
  driveReadFileText(tenantId: string, input: { fileId: string; maxChars?: number }): Promise<DriveFileText>;

  meetCreateSpace(tenantId: string): Promise<MeetSpace>;
  meetListConferences(tenantId: string, opts: { maxResults?: number }): Promise<MeetConference[]>;
  meetGetTranscript(
    tenantId: string,
    input: { conferenceRecord: string; maxChars?: number },
  ): Promise<MeetTranscript | null>;

  formsCreate(
    tenantId: string,
    input: { title: string; description?: string; questions: FormQuestion[]; isQuiz?: boolean; folderId?: string },
  ): Promise<FormRef>;
  formsAddQuestions(tenantId: string, input: { formId: string; questions: FormQuestion[] }): Promise<FormRef>;
  formsGetResponses(
    tenantId: string,
    input: { formId: string; maxResponses?: number },
  ): Promise<{ responses: FormResponse[]; truncated: boolean }>;

  slidesCreate(
    tenantId: string,
    input: { title: string; outline: SlideOutlineSlide[]; folderId?: string },
  ): Promise<PresentationRef>;
  slidesReadText(tenantId: string, input: { presentationId: string }): Promise<{ title?: string; text: string }>;

  classroomListCourses(tenantId: string, opts: { maxResults?: number }): Promise<ClassroomCourse[]>;
  classroomListCourseWork(tenantId: string, input: { courseId: string }): Promise<ClassroomCourseWork[]>;
  classroomListAnnouncements(tenantId: string, input: { courseId: string }): Promise<ClassroomAnnouncement[]>;
  classroomPostAnnouncement(tenantId: string, input: { courseId: string; text: string }): Promise<{ id: string }>;
  classroomListDueWork(tenantId: string, input: { withinDays: number }): Promise<ClassroomDueWork[]>;
  classroomListSubmissions(
    tenantId: string,
    input: { courseId: string; courseWorkId: string },
  ): Promise<ClassroomSubmission[]>;
  classroomCreateCourseWork(
    tenantId: string,
    input: { courseId: string; title: string; description?: string; dueDate?: string; maxPoints?: number },
  ): Promise<{ id: string; url?: string }>;

  getStagedUploadMeta(tenantId: string, uploadId: string): Promise<StagedUploadMeta | null>;
  readStagedUpload(
    tenantId: string,
    uploadId: string,
  ): Promise<(StagedUploadMeta & { data: Uint8Array }) | null>;
  readGmailAttachment(
    tenantId: string,
    input: { messageId: string; attachmentId: string },
  ): Promise<Uint8Array>;
}

let workspaceService: WorkspaceService | null = null;

export function registerWorkspaceService(service: WorkspaceService) {
  workspaceService = service;
}

export function getWorkspaceService(): WorkspaceService {
  if (!workspaceService) {
    throw new Error("Workspace service is not registered");
  }
  return workspaceService;
}

export function driveFileUrl(file: Pick<DriveFile, "id" | "isFolder" | "webViewLink">) {
  if (file.webViewLink) return file.webViewLink;
  return file.isFolder
    ? `https://drive.google.com/drive/folders/${file.id}`
    : `https://drive.google.com/file/d/${file.id}/view`;
}
