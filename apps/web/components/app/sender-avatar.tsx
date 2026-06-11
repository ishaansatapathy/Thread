"use client";

import { useMemo, useState } from "react";

function parseEmail(from?: string) {
  if (!from) return "";
  const bracket = from.match(/<([^>]+)>/);
  return (bracket?.[1] ?? from).trim();
}

function senderInitial(from?: string) {
  if (!from) return "?";
  const nameMatch = from.match(/^([^<]+)</);
  const label = nameMatch?.[1]?.trim().replace(/^"|"$/g, "") ?? parseEmail(from);
  return label.charAt(0).toUpperCase() || "?";
}

type SenderAvatarProps = {
  from?: string;
  selfEmail?: string;
  selfPhotoUrl?: string | null;
  size?: number;
};

export function SenderAvatar({
  from,
  selfEmail,
  selfPhotoUrl,
  size = 34,
}: SenderAvatarProps) {
  const email = parseEmail(from);
  const initial = senderInitial(from);
  const isSelf = Boolean(
    selfEmail && email && email.toLowerCase() === selfEmail.trim().toLowerCase(),
  );
  const [failed, setFailed] = useState(false);

  const photoSrc = useMemo(() => {
    if (failed) return null;
    if (isSelf && selfPhotoUrl) return selfPhotoUrl;
    if (!email) return null;
    return `/api/avatar?email=${encodeURIComponent(email)}`;
  }, [email, failed, isSelf, selfPhotoUrl]);

  return (
    <span
      className="thread-inbox-msg-avatar"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoSrc}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}
