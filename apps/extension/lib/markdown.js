// Tiny, safe markdown for agent replies: everything is HTML-escaped first, then only
// bold, inline code, fenced code blocks, http(s) links, bullet/numbered lists and paragraphs
// are turned back on.

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

export function renderMarkdown(source) {
  const html = [];
  let listTag = null;
  let items = [];
  const flush = () => {
    if (listTag) html.push(`<${listTag}>${items.join("")}</${listTag}>`);
    listTag = null;
    items = [];
  };

  let code = null; // lines of an open ``` block (an unclosed one still renders while streaming)
  for (const raw of escapeHtml(source ?? "").split("\n")) {
    if (/^\s*```/.test(raw)) {
      if (code) {
        html.push(`<pre><code>${code.join("\n")}</code></pre>`);
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const tag = bullet ? "ul" : "ol";
      if (listTag && listTag !== tag) flush();
      listTag = tag;
      items.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    html.push(heading ? `<p><strong>${inline(heading[1])}</strong></p>` : `<p>${inline(line)}</p>`);
  }
  flush();
  if (code) html.push(`<pre><code>${code.join("\n")}</code></pre>`);
  return html.join("");
}
