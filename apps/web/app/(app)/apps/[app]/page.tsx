"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import {
  ArrowUpRight,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Folder,
  GraduationCap,
  HardDrive,
  Loader2,
  Presentation,
  Search,
  Sparkles,
  Video,
} from "lucide-react";

import { trpc } from "~/trpc/client";
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
    blurb: "Create meeting links and turn transcripts into notes. Transcripts need transcription turned on in Meet.",
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

function FileList({ app, config }: { app: FileListSlug; config: AppConfig }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(id);
  }, [input]);

  const activeFolder = folderStack[folderStack.length - 1];
  const files = trpc.workspace.listFiles.useQuery(
    { app, query: query || undefined, folderId: activeFolder?.id },
    { staleTime: 30_000 },
  );

  // Folders first, newest within each group — matches how Drive itself sorts a listing.
  const sorted = [...(files.data?.files ?? [])].sort((a, b) => Number(b.isFolder) - Number(a.isFolder));

  const openFolder = (folder: { id: string; name: string }) => {
    setInput("");
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  return (
    <section className="thread-appx-panel">
      <div className="thread-appx-panel-head">
        <h3>{query ? "Results" : activeFolder ? activeFolder.name : "Recent"}</h3>
        <label className="thread-appx-search">
          <Search size={13} />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search by name" />
        </label>
      </div>

      {!query && folderStack.length > 0 ? (
        <div className="thread-appx-breadcrumb">
          <button type="button" onClick={() => setFolderStack([])}>
            <Folder size={12} />
            Home
          </button>
          {folderStack.map((crumb, i) => (
            <span key={crumb.id}>
              <span className="thread-appx-breadcrumb-sep">/</span>
              <button type="button" onClick={() => setFolderStack((prev) => prev.slice(0, i + 1))}>
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
      ) : sorted.length === 0 ? (
        <div className="thread-appx-empty">
          {query ? `Nothing matches "${query}".` : activeFolder ? "This folder is empty." : "No files yet."}
        </div>
      ) : (
        <ul className="thread-appx-list">
          {sorted.map((file) => {
            const Icon = fileIcon(file.mimeType, file.isFolder);
            return (
              <li key={file.id} className="thread-appx-row">
                {file.isFolder ? (
                  <button type="button" className="thread-appx-row-open" onClick={() => openFolder(file)}>
                    <span className="thread-appx-row-icon">
                      <Icon size={14} />
                    </span>
                    <span className="thread-appx-row-name">{file.name}</span>
                  </button>
                ) : (
                  <>
                    <span className="thread-appx-row-icon">
                      <Icon size={14} />
                    </span>
                    <span className="thread-appx-row-name">{file.name}</span>
                  </>
                )}
                <span className="thread-appx-row-meta">{formatWhen(file.modifiedTime)}</span>
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
          })}
        </ul>
      )}
    </section>
  );
}

function MeetingList() {
  const meetings = trpc.workspace.listMeetings.useQuery({}, { staleTime: 60_000 });

  return (
    <section className="thread-appx-panel">
      <div className="thread-appx-panel-head">
        <h3>Past meetings</h3>
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

function CourseList() {
  const courses = trpc.workspace.listClassroomCourses.useQuery({}, { staleTime: 60_000 });

  return (
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

      {connected ? (
        <>
          <div className="thread-appx-actions">
            {config.actions.map((a) => (
              <Link key={a.label} href={agentHref(a.prompt)} className="thread-appx-action">
                <Sparkles size={13} />
                {a.label}
              </Link>
            ))}
          </div>
          {slug === "meet" ? (
            <MeetingList />
          ) : slug === "classroom" ? (
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
