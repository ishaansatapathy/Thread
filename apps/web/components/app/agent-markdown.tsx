"use client";

import { memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_PROTOCOL = /^(https?:|mailto:)/i;
const MEET_LINK = /^https:\/\/meet\.google\.com\//i;

/** Renders agent replies as markdown. Raw HTML is never rendered; links open in a new tab.
 *  Google Meet links open as a popup window and navigate Thread to the meet room. */
export const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  const router = useRouter();

  const handleMeetClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      const href = e.currentTarget.href;
      e.preventDefault();
      // Open Meet in a floating popup so the user stays inside Thread.
      const popup = window.open(
        "about:blank",
        "thread-meet-popup",
        "popup,width=1080,height=720,menubar=no,toolbar=no,location=no",
      );
      if (popup) popup.location.href = href;
      router.push(`/apps/meet?autoJoin=${encodeURIComponent(href)}`);
    },
    [router],
  );

  const components: Components = {
    a: ({ href, children }) => {
      if (!href || !SAFE_PROTOCOL.test(href)) return <span>{children}</span>;
      if (MEET_LINK.test(href)) {
        return (
          <a href={href} onClick={handleMeetClick} className="thread-agent-msg-link">
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="thread-agent-msg-link">
          {children}
        </a>
      );
    },
    img: () => null,
    table: ({ children }) => (
      <div className="thread-md-table">
        <table>{children}</table>
      </div>
    ),
  };

  return (
    <div className="thread-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
