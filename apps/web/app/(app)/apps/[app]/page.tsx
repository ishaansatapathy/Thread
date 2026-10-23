"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import {
  ArrowUpRight,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderTree,
  GraduationCap,
  HardDrive,
  Loader2,
  Presentation,
  Search,
  Sparkles,
  Video,
} from "lucide-react";

import { trpc } from "~/trpc/client";
import { MeetHub } from "~/components/app/meet-hub";
import { useWorkspaceConnections, type AppKey } from "~/components/app/thread-workspace-connect";

type AppSlug = "drive" | "docs" | "sheets" | "meet" | "forms" | "slides" | "classroom";
type FileListSlug = "drive" | "docs" | "sheets" | "forms" | "slides";
const FILE_LIST_SLUGS = new Set<AppSlug>(["drive", "docs", "sheets", "forms", "slides"]);

type AppConfig = {
  name: string;
  status: AppKey;
  connectPath: string;
  icon: ComponentType<{ size?: number }>;
  blurb: string;
  actions: Array<{ label: string; prompt: string }>;
  itemPrompt?: (name: string, url: string) => string;
};

const APPS: Record<AppSlug, AppConfig> = {
  drive: {
    name: "Google Drive",
    status: "googledrive",
    connectPath: "/api-connect/workspace/googledrive",
    icon: HardDrive,
    blurb: "Save attachments into folders, move and share files. Every change waits in Queue.",
    actions: [
      { label: "Save today's attachments", prompt: "Find emails from today with attachments and save them to Drive in a folder named after the sender." },
      { label: "Organise receipts", prompt: "Find receipt and invoice emails from this month and save their attachments to a Drive folder called Receipts." },
      { label: "New folder", prompt: "Create a new Drive folder called " },
    ],
    itemPrompt: (name, url) => `Tell me about the Drive file "${name}" (${url}) and who I might share it with.`,
  },
  docs: {
    name: "Google Docs",
    status: "googledocs",
    connectPath: "/api-connect/workspace/googledrive",
    icon: FileText,
    blurb: "Write formatted docs from your mail and meetings. Runs on your Drive connection.",
    actions: [
      { label: "Weekly update doc", prompt: "Write a Google Doc summarising my important email threads from this week, with headings per project." },
      { label: "Doc from a thread", prompt: "Turn my latest important email thread into a Google Doc with a summary and action items." },
    ],
    itemPrompt: (name, url) => `Read the Google Doc "${name}" (${url}) and summarise it with key decisions and action items.`,
  },
  sheets: {
    name: "Google Sheets",
    status: "googlesheets",
    connectPath: "/api-connect/workspace/googlesheets",
    icon: FileSpreadsheet,
    blurb: "Turn email data into spreadsheets and keep them updated.",
    actions: [
      { label: "Expenses sheet", prompt: "Create a Google Sheet of my receipts and invoices from this month with date, vendor and amount columns." },
      { label: "Contacts sheet", prompt: "Create a Google Sheet of the people I emailed most this month with name, email and last contact date." },
    ],
    itemPrompt: (name, url) => `Read the Google Sheet "${name}" (${url}) and give me the key numbers and trends.`,
  },
  meet: {
    name: "Google Meet",
    status: "googlemeet",
    connectPath: "/api-connect/workspace/googlemeet",
    icon: Video,
    blurb: "Start or join a Meet and Thread listens in — live multilingual transcript by Gnani, running notes, and an agent you can talk to mid-call.",
    actions: [
      { label: "New meeting link", prompt: "Create a Google Meet link for me." },
      { label: "Notes from last meeting", prompt: "Get the transcript of my most recent Google Meet and write meeting notes with action items." },
    ],
  },
  forms: {
    name: "Google Forms",
    status: "googleforms",
    connectPath: "/api-connect/workspace/googleforms",
    icon: ClipboardList,
    blurb: "Build surveys, quizzes and sign-ups, and read back the responses.",
    actions: [
      { label: "Event RSVP form", prompt: "Create a Google Form to RSVP for an event, with name, email and a yes/no attending question." },
      { label: "Feedback survey", prompt: "Create a short feedback survey as a Google Form with a few questions about my product." },
    ],
    itemPrompt: (name, url) => `Read the responses to the Google Form "${name}" (${url}) and summarise what people said.`,
  },
  slides: {
    name: "Google Slides",
    status: "googleslides",
    connectPath: "/api-connect/workspace/googleslides",
    icon: Presentation,
    blurb: "Turn an outline, email thread or notes into a slide deck.",
    actions: [
      { label: "Weekly update deck", prompt: "Create a Google Slides presentation summarising my important email threads from this week, one slide per topic." },
      { label: "Deck from a thread", prompt: "Turn my latest important email thread into a short Google Slides presentation." },
    ],
    itemPrompt: (name, url) => `Read the Google Slides presentation "${name}" (${url}) and summarise the key points.`,
  },
  classroom: {
    name: "Google Classroom",
    status: "googleclassroom",
    connectPath: "/api-connect/workspace/googleclassroom",
    icon: GraduationCap,
    blurb: "See courses, coursework and announcements, and post updates. Posting goes through Queue.",
    actions: [],
  },
};

function agentHref(prompt: string) {
  return `/agent?prompt=${encodeURIComponent(prompt)}`;
}

function formatWhen(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function formatDuration(start?: string, end?: string) {
  if (!start || !end) return "";
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

function fileIcon(mimeType: string | undefined, isFolder: boolean) {
  if (isFolder) return Folder;
  if (mimeType === "application/vnd.google-apps.document") return FileText;
  if (mimeType === "application/vnd.google-apps.spreadsheet") return FileSpreadsheet;
  if (mimeType === "application/vnd.google-apps.form") return ClipboardList;
  if (mimeType === "application/vnd.google-apps.presentation") return Presentation;
  return HardDrive;
}

type FolderCrumb = { id: string; name: string };
type ListedFile = { id: string; name: string; mimeType?: string; isFolder: boolean; url: string; modifiedTime?: string; size?: number };

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function typeLabel(mimeType?: string, isFolder?: boolean) {
  if (isFolder) return "Folder";
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "Google Doc";
    case "application/vnd.google-apps.spreadsheet":
      return "Google Sheet";
    case "application/vnd.google-apps.presentation":
      return "Google Slides";
    case "application/vnd.google-apps.form":
      return "Google Form";
    case "application/pdf":
      return "PDF";
    default:
      if (mimeType?.startsWith("image/")) return "Image";
      if (mimeType?.startsWith("video/")) return "Video";
      if (mimeType?.startsWith("audio/")) return "Audio";
      return mimeType?.split("/").pop()?.toUpperCase() ?? "File";
  }
}

type HoverState = { file: ListedFile; rect: DOMRect } | null;

const HOVER_OPEN_MS = 450;
const HOVER_CLOSE_MS = 180;

/** Drive-style hover card: thumbnail, owner, last editor and a peek at the text. */
function DriveHoverCard({ hover, onEnter, onLeave }: { hover: NonNullable<HoverState>; onEnter: () => void; onLeave: () => void }) {
  const preview = trpc.workspace.filePreview.useQuery({ fileId: hover.file.id }, { staleTime: 5 * 60_000, retry: false });
  const [imageFailed, setImageFailed] = useState(false);
  const Icon = fileIcon(hover.file.mimeType, hover.file.isFolder);
  const data = preview.data;

  const width = 340;
  const left = Math.max(8, Math.min(hover.rect.left + 44, window.innerWidth - width - 8));
  const below = hover.rect.bottom + 300 < window.innerHeight;
  const style = below
    ? { left, top: hover.rect.bottom + 6, width }
    : { left, bottom: window.innerHeight - hover.rect.top + 6, width };

  return (
    <div className="thread-drive-hover" style={style} onMouseEnter={onEnter} onMouseLeave={onLeave} role="tooltip">
      {data?.thumbnailUrl && !imageFailed ? (
        <div className="thread-drive-hover-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived Google thumbnail URL */}
          <img src={data.thumbnailUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        </div>
      ) : null}
      <div className="thread-drive-hover-body">
        <div className="thread-drive-hover-title">
          <Icon size={14} />
          <strong>{hover.file.name}</strong>
        </div>
        <div className="thread-drive-hover-meta">
          <span>{typeLabel(hover.file.mimeType, hover.file.isFolder)}</span>
          {hover.file.size ? <span>{formatSize(hover.file.size)}</span> : null}
          {data?.childCount !== undefined ? <span>{data.childCount === 100 ? "100+ items" : `${data.childCount} items`}</span> : null}
        </div>
        {preview.isLoading ? (
          <div className="thread-drive-hover-loading">
            <Loader2 size={13} className="thread-spin" />
          </div>
        ) : data ? (
          <>
            <dl className="thread-drive-hover-facts">
              {data.modifiedTime ? (
                <>
                  <dt>Modified</dt>
                  <dd>
                    {new Date(data.modifiedTime).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                    {data.lastModifiedBy ? ` by ${data.lastModifiedBy}` : ""}
                  </dd>
                </>
              ) : null}
              {data.owner ? (
                <>
                  <dt>Owner</dt>
                  <dd>{data.owner}</dd>
                </>
              ) : null}
            </dl>
            {data.description ? <p className="thread-drive-hover-desc">{data.description}</p> : null}
            {data.snippet ? <p className="thread-drive-hover-snippet">{data.snippet}</p> : null}
          </>
        ) : preview.isError ? (
          <p className="thread-drive-hover-desc">Preview unavailable.</p>
        ) : null}
      </div>
    </div>
  );
}

function useHoverPreview() {
  const [hover, setHover] = useState<HoverState>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clear = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  const enterRow = (file: ListedFile, el: HTMLElement) => {
    clear();
    openTimer.current = window.setTimeout(() => setHover({ file, rect: el.getBoundingClientRect() }), HOVER_OPEN_MS);
  };
  const leave = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    closeTimer.current = window.setTimeout(() => setHover(null), HOVER_CLOSE_MS);
  };
  const keep = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  useEffect(() => {
    if (!hover) return;
    const close = () => setHover(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [hover]);

  useEffect(() => () => clear(), []);

  return { hover, enterRow, leave, keep, dismiss: () => setHover(null) };
}

function FileRow({
  file,
  config,
  onOpenFolder,
  hoverHandlers,
}: {
  file: ListedFile;
  config: AppConfig;
  onOpenFolder: (file: ListedFile) => void;
  hoverHandlers: ReturnType<typeof useHoverPreview>;
}) {
  const Icon = fileIcon(file.mimeType, file.isFolder);
  return (
    <li
      className="thread-appx-row"
      onMouseEnter={(e) => hoverHandlers.enterRow(file, e.currentTarget)}
      onMouseLeave={hoverHandlers.leave}
    >
      {file.isFolder ? (
        <button type="button" className="thread-appx-row-open" onClick={() => onOpenFolder(file)}>
          <span className="thread-appx-row-icon" data-folder="true">
            <Icon size={14} />
          </span>
          <span className="thread-appx-row-name">{file.name}</span>
        </button>
      ) : (
        <a href={file.url} target="_blank" rel="noopener noreferrer" className="thread-appx-row-open">
          <span className="thread-appx-row-icon">
            <Icon size={14} />
          </span>
          <span className="thread-appx-row-name">{file.name}</span>
        </a>
      )}
      <span className="thread-appx-row-meta">
        {file.size ? `${formatSize(file.size)} · ` : ""}
        {formatWhen(file.modifiedTime)}
      </span>
      <span className="thread-appx-row-actions">
        {config.itemPrompt && !file.isFolder ? (
          <Link href={agentHref(config.itemPrompt(file.name, file.url))} className="thread-appx-iconbtn" title="Ask Agent">
            <Sparkles size={13} />
          </Link>
        ) : null}
        <a href={file.url} target="_blank" rel="noopener noreferrer" className="thread-appx-iconbtn" title="Open in Google">
          <ArrowUpRight size={13} />
        </a>
      </span>
    </li>
  );
}

function FileList({ app, config }: { app: FileListSlug; config: AppConfig }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"recent" | "folders">("recent");
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);
  const hover = useHoverPreview();
  const canBrowse = app === "drive";

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(id);
  }, [input]);

  const browsing = canBrowse && view === "folders";
  const activeFolder = folderStack[folderStack.length - 1];
  const files = trpc.workspace.listFiles.useQuery(
    { app, query: query || undefined, folderId: browsing ? activeFolder?.id : undefined, view: browsing ? "folders" : "recent" },
    { staleTime: 30_000 },
  );

  const all = files.data?.files ?? [];
  const folders = all.filter((f) => f.isFolder);
  const plainFiles = all.filter((f) => !f.isFolder);

  const openFolder = (folder: ListedFile) => {
    hover.dismiss();
    setInput("");
    setQuery("");
    if (!browsing) {
      setView("folders");
      setFolderStack([{ id: folder.id, name: folder.name }]);
      return;
    }
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const switchView = (next: "recent" | "folders") => {
    hover.dismiss();
    setView(next);
    setFolderStack([]);
  };

  const heading = query ? "Results" : browsing ? (activeFolder ? activeFolder.name : "My Drive") : "Recent";
  const emptyText = query ? `Nothing matches "${query}".` : browsing ? (activeFolder ? "This folder is empty." : "My Drive is empty.") : "No files yet.";

  return (
    <section className="thread-appx-panel">
      <div className="thread-appx-panel-head">
        {canBrowse ? (
          <div className="thread-appx-viewtabs" role="tablist" aria-label="Drive view">
            <button type="button" role="tab" aria-selected={view === "recent"} data-active={view === "recent" ? "true" : undefined} onClick={() => switchView("recent")}>
              <Clock3 size={12} /> Recent
            </button>
            <button type="button" role="tab" aria-selected={view === "folders"} data-active={view === "folders" ? "true" : undefined} onClick={() => switchView("folders")}>
              <FolderTree size={12} /> Folders
            </button>
          </div>
        ) : (
          <h3>{heading}</h3>
        )}
        <label className="thread-appx-search">
          <Search size={13} />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={canBrowse ? "Search all of Drive" : "Search by name"} />
        </label>
      </div>

      {browsing && !query ? (
        <div className="thread-appx-breadcrumb">
          <button type="button" onClick={() => setFolderStack([])} data-current={folderStack.length === 0 ? "true" : undefined}>
            <HardDrive size={12} />
            My Drive
          </button>
          {folderStack.map((crumb, i) => (
            <span key={crumb.id}>
              <span className="thread-appx-breadcrumb-sep">/</span>
              <button
                type="button"
                onClick={() => setFolderStack((prev) => prev.slice(0, i + 1))}
                data-current={i === folderStack.length - 1 ? "true" : undefined}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {files.isLoading ? (
        <div className="thread-appx-empty">
          <Loader2 size={16} className="thread-spin" />
        </div>
      ) : files.isError ? (
        <div className="thread-appx-empty">{files.error.message}</div>
      ) : all.length === 0 ? (
        <div className="thread-appx-empty">{emptyText}</div>
      ) : browsing && !query ? (
        <>
          {folders.length ? (
            <>
              <div className="thread-appx-subhead">Folders</div>
              <div className="thread-drive-folders">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="thread-drive-folder"
                    onClick={() => openFolder(folder)}
                    onMouseEnter={(e) => hover.enterRow(folder, e.currentTarget)}
                    onMouseLeave={hover.leave}
                    title={folder.name}
                  >
                    <Folder size={16} />
                    <span>{folder.name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {plainFiles.length ? (
            <>
              <div className="thread-appx-subhead">Files</div>
              <ul className="thread-appx-list">
                {plainFiles.map((file) => (
                  <FileRow key={file.id} file={file} config={config} onOpenFolder={openFolder} hoverHandlers={hover} />
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <ul className="thread-appx-list">
          {all.map((file) => (
            <FileRow key={file.id} file={file} config={config} onOpenFolder={openFolder} hoverHandlers={hover} />
          ))}
        </ul>
      )}

      {hover.hover ? <DriveHoverCard hover={hover.hover} onEnter={hover.keep} onLeave={hover.leave} /> : null}
    </section>
  );
}

function MeetingList() {
  const meetings = trpc.workspace.listMeetings.useQuery({}, { staleTime: 60_000 });

  return (
    <section className="thread-appx-panel">
      <div className="thread-appx-panel-head">
        <h3>Google Meet history</h3>
      </div>
      {meetings.isLoading ? (
        <div className="thread-appx-empty">
          <Loader2 size={16} className="thread-spin" />
        </div>
      ) : meetings.isError ? (
        <div className="thread-appx-empty">{meetings.error.message}</div>
      ) : !meetings.data?.meetings.length ? (
        <div className="thread-appx-empty">No past meetings found for this account.</div>
      ) : (
        <ul className="thread-appx-list">
          {meetings.data.meetings.map((m) => (
            <li key={m.name} className="thread-appx-row">
              <span className="thread-appx-row-icon">
                <Video size={14} />
              </span>
              <span className="thread-appx-row-name">
                {m.startTime
                  ? new Date(m.startTime).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
                  : m.name}
              </span>
              <span className="thread-appx-row-meta">{formatDuration(m.startTime, m.endTime)}</span>
              <span className="thread-appx-row-actions">
                <Link
                  href={agentHref(`Get the transcript for Meet conference ${m.name} and write meeting notes with action items.`)}
                  className="thread-appx-chip"
                >
                  <Sparkles size={12} /> Notes
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SUBMISSION_LABEL: Record<string, string> = {
  TURNED_IN: "Turned in",
  RETURNED: "Returned",
  RECLAIMED_BY_STUDENT: "Unsubmitted",
  CREATED: "To do",
  NEW: "To do",
};

function DueWork() {
  const due = trpc.workspace.classroomDueWork.useQuery({ withinDays: 14 }, { staleTime: 60_000 });
  const work = due.data?.work ?? [];

  return (
    <section className="thread-appx-panel">
      <div className="thread-appx-panel-head">
        <h3>Due in the next 2 weeks</h3>
      </div>
      {due.isLoading ? (
        <div className="thread-appx-empty">
          <Loader2 size={16} className="thread-spin" />
        </div>
      ) : due.isError ? (
        <div className="thread-appx-empty">{due.error.message}</div>
      ) : work.length === 0 ? (
        <div className="thread-appx-empty">Nothing due in the next two weeks.</div>
      ) : (
        <ul className="thread-appx-list">
          {work.map((w) => (
            <li key={`${w.courseId}-${w.id}`} className="thread-appx-row">
              <span className="thread-appx-row-icon">
                <ClipboardList size={14} />
              </span>
              <span className="thread-appx-row-name">
                {w.title}
                <small className="thread-appx-row-sub">{w.courseName}</small>
              </span>
              <span className="thread-appx-row-meta">
                {w.mySubmissionState ? `${SUBMISSION_LABEL[w.mySubmissionState] ?? w.mySubmissionState} · ` : ""}
                {w.dueDate ? formatWhen(w.dueDate) : "No due date"}
                {w.late ? " · late" : ""}
              </span>
              <span className="thread-appx-row-actions">
                <Link
                  href={agentHref(`Help me plan "${w.title}" for ${w.courseName} (courseId ${w.courseId}, courseWorkId ${w.id}): read the assignment, break it into steps and put focus time on my calendar before it's due.`)}
                  className="thread-appx-chip"
                >
                  <Sparkles size={12} /> Plan it
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CourseList() {
  const courses = trpc.workspace.listClassroomCourses.useQuery({}, { staleTime: 60_000 });

  return (
    <>
    <DueWork />
    <section className="thread-appx-panel">
      <div className="thread-appx-panel-head">
        <h3>Courses</h3>
      </div>
      {courses.isLoading ? (
        <div className="thread-appx-empty">
          <Loader2 size={16} className="thread-spin" />
        </div>
      ) : courses.isError ? (
        <div className="thread-appx-empty">{courses.error.message}</div>
      ) : !courses.data?.courses.length ? (
        <div className="thread-appx-empty">No active courses found for this account.</div>
      ) : (
        <ul className="thread-appx-list">
          {courses.data.courses.map((course) => (
            <li key={course.id} className="thread-appx-row">
              <span className="thread-appx-row-icon">
                <GraduationCap size={14} />
              </span>
              <span className="thread-appx-row-name">{course.name}</span>
              <span className="thread-appx-row-meta">{course.section ?? ""}</span>
              <span className="thread-appx-row-actions">
                <Link href={agentHref(`List the coursework and due dates for my Classroom course "${course.name}" (id ${course.id}).`)} className="thread-appx-chip">
                  <Sparkles size={12} /> Coursework
                </Link>
                <Link href={agentHref(`Post an announcement to my Classroom course "${course.name}" (id ${course.id}): `)} className="thread-appx-chip">
                  <Sparkles size={12} /> Announce
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
    </>
  );
}

export default function WorkspaceAppPage() {
  const params = useParams<{ app: string }>();
  const slug = params.app as AppSlug;
  const config = APPS[slug];
  const { states } = useWorkspaceConnections();
  if (!config) notFound();

  const state = states[config.status];
  const connected = state === "connected";
  const Icon = config.icon;

  return (
    <div className="thread-app-content-narrow thread-appx">
      <header className="thread-appx-hero">
        <span className="thread-appx-hero-icon" data-on={connected}>
          <Icon size={20} />
        </span>
        <div className="thread-appx-hero-meta">
          <h2>{config.name}</h2>
          <p>{config.blurb}</p>
        </div>
        {state === "loading" ? (
          <Loader2 size={16} className="thread-spin" style={{ color: "var(--thread-dim)" }} />
        ) : connected ? (
          <span className="thread-appx-status">Connected</span>
        ) : state === "not_configured" ? (
          <span className="thread-appx-status" data-off="true">Unavailable</span>
        ) : (
          <a href={`${config.connectPath}?state=${encodeURIComponent(`/apps/${slug}`)}`} className="thread-btn-accent">
            Connect
          </a>
        )}
      </header>

      {slug === "meet" ? (
        state === "loading" ? null : (
          <>
            <MeetHub
              meetConnected={connected}
              connectHref={`${config.connectPath}?state=${encodeURIComponent(`/apps/${slug}`)}`}
            />
            {connected ? <MeetingList /> : null}
          </>
        )
      ) : connected ? (
        <>
          <div className="thread-appx-actions">
            {config.actions.map((a) => (
              <Link key={a.label} href={agentHref(a.prompt)} className="thread-appx-action">
                <Sparkles size={13} />
                {a.label}
              </Link>
            ))}
          </div>
          {slug === "classroom" ? (
            <CourseList />
          ) : FILE_LIST_SLUGS.has(slug) ? (
            <FileList app={slug as FileListSlug} config={config} />
          ) : null}
        </>
      ) : state === "loading" ? null : (
        <div className="thread-appx-panel thread-appx-empty thread-appx-locked">
          Connect {config.name} to browse it here and let the agent work with it. Nothing changes without your approval in Queue.
        </div>
      )}
    </div>
  );
}
