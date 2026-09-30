// Pulls the weekly shape out of an Episode's cleaned description (the output of
// normalizeDescription) so the Episode Page can stage each part on its own
// (ADR 0019). Every week the notes run the same way:
//
//   <p><em>"A line from the film."</em></p>          -> quote
//   <p>(5:40) NFL CITY FRANCHISE QUIZ</p>            -> chapters
//   <p><strong>RENN'S PICK x DAD-TEMBER</strong></p> -> billing
//   <p>Following the death of their mother, …</p>   -> prose
//
// Anything that doesn't fit a slot falls through to prose untouched, so an
// Episode that breaks the pattern degrades to its plain description.
//
// Pure — string in, object out. No DOM, so it runs under node --test.

const P_BLOCK = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

// "(5:40) LABEL", "( 1:19:25 ) LABEL", "(27:20 )LABEL" and "LABEL (6:40)" all occur in the feed.
const STAMP_LEADING = /^\(\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*\)\s*(.+)$/;
const STAMP_TRAILING = /^(.+?)\s*\(\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*\)$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function textOf(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** True when the block's whole content is one <tag>…</tag> element. */
function isOnly(inner, tag) {
  return new RegExp(`^\\s*<${tag}\\b[^>]*>[\\s\\S]*<\\/${tag}>\\s*$`, 'i').test(inner);
}

function stripQuotes(str) {
  return str.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
}

/** "1:09:42" -> 4182. Unparseable -> 0. */
export function toSeconds(stamp) {
  const parts = String(stamp ?? '').trim().split(':');
  if (!parts[0] || parts.some((p) => !/^\d+$/.test(p))) return 0;
  return parts.reduce((acc, n) => acc * 60 + Number(n), 0);
}

function parseChapter(text) {
  const lead = text.match(STAMP_LEADING);
  if (lead) return { at: lead[1], label: lead[2].trim() };
  const trail = text.match(STAMP_TRAILING);
  if (trail) return { at: trail[2], label: trail[1].trim() };
  return null;
}

// "RENN'S PICK x DAD-TEMBER" -> { label: "RENN'S PICK", theme: "DAD-TEMBER" }.
// One Episode has it backwards ("FORGIVE ME LORD… X Renn's Pick"), so a pick
// on the right is swapped over to the left. Older Episodes bill the pick alone
// ("RENN'S PICK"), which is billing with no theme.
function parseBilling(text) {
  const m = text.match(/^(.+?)\s+x\s+(.+)$/i);
  if (!m) {
    const bare = stripQuotes(text);
    return /^[\p{L} .'’-]{1,24}['’]S PICKS?!?$/iu.test(bare) ? { label: bare, theme: '' } : null;
  }
  let label = stripQuotes(m[1]);
  let theme = stripQuotes(m[2]);
  if (/\bpick$/i.test(theme) && !/\bpick$/i.test(label)) [label, theme] = [theme, label];
  return label && theme ? { label, theme } : null;
}

/**
 * @param {string} cleanedHtml  normalizeDescription(...).cleanedHtml
 * @param {string} [duration]   the Episode's itunes:duration ("01:33:56"), so the
 *                              last Chapter knows where it ends
 * @returns {{ quote: string, chapters: Array<{at: string, secs: number, len: number, label: string}>,
 *             billing: {label: string, theme: string} | null, proseHtml: string }}
 */
export function parseShowNotes(cleanedHtml, duration = '') {
  const html = typeof cleanedHtml === 'string' ? cleanedHtml : '';
  let quote = '';
  let billing = null;
  const chapters = [];
  const prose = [];
  let last = 0;

  const keepLoose = (chunk) => { if (chunk.trim()) prose.push(chunk.trim()); };

  for (const match of html.matchAll(P_BLOCK)) {
    keepLoose(html.slice(last, match.index));
    last = match.index + match[0].length;
    const inner = match[1];
    const text = textOf(inner);
    if (!text) continue;

    const chapter = parseChapter(text);
    if (chapter) {
      chapters.push({ ...chapter, secs: toSeconds(chapter.at) });
      continue;
    }
    // "👇 TIMESTAMPS & MOMENTS COVERED 👇" only introduces the Chapters.
    if (/\bTIMESTAMPS\b/.test(text) && text.length < 60) continue;
    // The film quote leads the notes: usually italic, sometimes bold in quote marks.
    const quoted = isOnly(inner, 'em') || (isOnly(inner, 'strong') && /^["“]/.test(text));
    if (!quote && !prose.length && !chapters.length && quoted) {
      quote = stripQuotes(text);
      continue;
    }
    if (!billing && isOnly(inner, 'strong')) {
      const b = parseBilling(text);
      if (b) { billing = b; continue; }
    }
    prose.push(match[0]);
  }
  keepLoose(html.slice(last));

  // Each Chapter runs until the next one; the last runs to the end of the Episode.
  const total = toSeconds(duration);
  chapters.sort((a, b) => a.secs - b.secs);
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.secs ?? Math.max(total, c.secs);
    c.len = end - c.secs;
  });

  return { quote, chapters, billing, proseHtml: prose.join('') };
}
