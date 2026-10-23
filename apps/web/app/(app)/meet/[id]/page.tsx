"use client";

import { useParams } from "next/navigation";

import { MeetingRoom } from "~/components/app/meeting-room";

export default function MeetingRoomPage() {
  const params = useParams<{ id: string }>();
  return <MeetingRoom meetingId={params.id} />;
}
