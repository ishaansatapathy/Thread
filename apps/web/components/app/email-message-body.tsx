"use client";

import DOMPurify from "isomorphic-dompurify";

type EmailMessageBodyProps = {
  bodyHtml?: string | null;
  body?: string | null;
  snippet?: string | null;
  className?: string;
};

export function EmailMessageBody({ bodyHtml, body, snippet, className }: EmailMessageBodyProps) {
  const plain = body?.trim() || snippet?.trim() || "(No content)";

  if (bodyHtml?.trim()) {
    const sanitized = DOMPurify.sanitize(bodyHtml, {
      ADD_ATTR: ["target", "rel"],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });

    return (
      <div
        className={className ? `thread-email-html-body ${className}` : "thread-email-html-body"}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  }

  return <div className={className ?? "thread-inbox-msg-body"}>{plain}</div>;
}
