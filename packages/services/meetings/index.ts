import type {
  MeetingMode,
  MeetingNotes,
  MeetingSegment,
  MeetingStatus,
} from "@repo/database/schema";

export type { MeetingMode, MeetingNotes, MeetingSegment, MeetingStatus };

export type MeetingListItem = {
  id: string;
  title: string | null;
  mode: MeetingMode;
  status: MeetingStatus;
  meetUrl: string | null;
  languageCode: string | null;
  segmentCount: number;
  durationSeconds: number;
  summary: string | null;
  createdAt: string;
  endedAt: string | null;
};

export type MeetingDetail = MeetingListItem & {
  segments: MeetingSegment[];
  notes: MeetingNotes | null;
  /** Segments (in arrival order) the notes already cover; the rest are newer. */
  summarizedCount: number;
  errorMessage: string | null;
};

export interface MeetingService {
  isTranscriptionConfigured(): boolean;
  create(
    tenantId: string,
    input: { title?: string; languageCode?: string; mode?: MeetingMode; meetUrl?: string },
  ): Promise<MeetingDetail>;
  list(tenantId: string, opts?: { limit?: number }): Promise<MeetingListItem[]>;
  get(tenantId: string, meetingId: string): Promise<MeetingDetail>;
  rename(tenantId: string, meetingId: string, title: string): Promise<MeetingDetail>;
  /** Folds any un-summarised transcript into the notes, then marks the meeting ready. */
  end(tenantId: string, meetingId: string): Promise<MeetingDetail>;
  /** Folds any un-summarised transcript into the notes now, without ending the meeting. */
  refreshNotes(tenantId: string, meetingId: string): Promise<MeetingDetail>;
  remove(tenantId: string, meetingId: string): Promise<void>;
  /**
   * Compact context for the agent: rolling notes + only the most recent part of the
   * transcript, so the prompt stays small however long the meeting runs.
   */
  agentContext(tenantId: string, meetingId: string): Promise<string>;
}

let meetingService: MeetingService | null = null;

export function registerMeetingService(service: MeetingService) {
  meetingService = service;
}

export function getMeetingService(): MeetingService {
  if (!meetingService) throw new Error("Meeting service is not registered");
  return meetingService;
}

export function hasMeetingService(): boolean {
  return meetingService !== null;
}
