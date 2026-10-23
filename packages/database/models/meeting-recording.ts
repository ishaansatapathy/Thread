import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./user";

/** pending → live (chunks streaming in) or processing (batch upload) → ready | failed */
export type MeetingStatus = "pending" | "live" | "processing" | "ready" | "failed";
export type MeetingMode = "live" | "upload";

export type MeetingSegment = {
  /** "you" / "meeting" for live capture, Gnani's numeric id for diarized uploads. */
  speakerId: string;
  /** Seconds from the start of the meeting. */
  startTime: number;
  endTime: number;
  text: string;
};

export type MeetingNotes = {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{ action: string; owner?: string; deadline?: string }>;
};

/** A meeting captured live or uploaded, transcribed by Gnani, with AI notes. */
export const meetingRecordingsTable = pgTable(
  "meeting_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }),
    mode: varchar("mode", { length: 20 }).notNull().default("upload"),
    meetUrl: varchar("meet_url", { length: 500 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    languageCode: varchar("language_code", { length: 20 }).default("auto"),
    gnaniJobId: varchar("gnani_job_id", { length: 120 }),
    transcript: text("transcript"),
    segmentsJson: jsonb("segments_json").$type<MeetingSegment[]>(),
    /** Rolling notes while live (folded in incrementally), final notes once ready. */
    notesJson: jsonb("notes_json").$type<MeetingNotes>(),
    /** How many segments (in arrival order) notesJson already covers. */
    summarizedCount: integer("summarized_count").notNull().default(0),
    errorMessage: text("error_message"),
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index("meeting_recordings_user_created_idx").on(t.userId, t.createdAt),
    statusIdx: index("meeting_recordings_status_idx").on(t.status),
  }),
);

export type SelectMeetingRecording = typeof meetingRecordingsTable.$inferSelect;
export type InsertMeetingRecording = typeof meetingRecordingsTable.$inferInsert;
