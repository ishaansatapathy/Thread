"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

const components: Components = {
  a: ({ href, children }) =>
    href && SAFE_PROTOCOL.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="thread-agent-msg-link">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: () => null,
  table: ({ children }) => (
    <div className="thread-md-table">
      <table>{children}</table>
    </div>
  ),
};

/** Renders agent replies as markdown. Raw HTML is never rendered; links open in a new tab. */
export const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="thread-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
