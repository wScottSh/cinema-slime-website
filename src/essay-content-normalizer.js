export function normalizeEssayContent(markdown) {
  const raw = typeof markdown === 'string' ? markdown : '';
  if (!raw.trim()) return { bodyHtml: '', rawMarkdown: raw };

  const bodyHtml = renderBlocks(raw);
  return { bodyHtml, rawMarkdown: raw };
}

function renderBlocks(markdown) {
  const blocks = markdown.split(/\n{2,}/);
  return blocks
    .map(block => block.trim())
    .filter(Boolean)
    .map(renderBlock)
    .join('\n');
}

function renderBlock(block) {
  const headingMatch = block.match(/^(#{1,6})\s+(.*)/s);
  if (headingMatch) {
    const level = headingMatch[1].length;
    return `<h${level}>${escapeText(headingMatch[2].trim())}</h${level}>`;
  }

  const lines = block.split('\n');
  const renderedLines = lines.map(line => renderInline(line));
  return `<p>${renderedLines.join('<br>')}</p>`;
}

function renderInline(text) {
  // YouTube embed — standalone line (checked before any escaping)
  const youtubeId = extractYoutubeId(text.trim());
  if (youtubeId) {
    return `</p><div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${escapeAttr(youtubeId)}" allowfullscreen loading="lazy" title="YouTube video"></iframe></div><p>`;
  }

  // Collect safe tags we generate, keyed by placeholder, then escape everything
  // else. This guarantees no raw HTML from the author can survive.
  const safeTags = [];
  let processed = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    if (!isSafeUrl(url)) return match; // leave as-is; will be escaped below
    const tag = `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy">`;
    const placeholder = `\x00IMG${safeTags.length}\x00`;
    safeTags.push(tag);
    return placeholder;
  });

  // Escape all remaining text (including any raw HTML the author wrote)
  processed = escapeText(processed);

  // Restore placeholders (they survive escaping since \x00 is not escaped)
  processed = processed.replace(/\x00IMG(\d+)\x00/g, (_, i) => safeTags[Number(i)]);

  return processed;
}

function extractYoutubeId(text) {
  // https://www.youtube.com/watch?v=ID or https://youtu.be/ID
  const watchMatch = text.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{11})(?:&[^#]*)?(?:#.*)?$/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = text.match(/^https?:\/\/youtu\.be\/([\w-]{11})(?:[?#].*)?$/);
  if (shortMatch) return shortMatch[1];
  return null;
}

function isSafeUrl(url) {
  return /^https?:\/\//i.test(url.trim());
}

function escapeText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

