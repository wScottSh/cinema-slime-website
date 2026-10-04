// Link Preview metadata for Episode Pages and Essay Pages (ADR 0020).
//
// Link unfurlers (Discord, Slack, iMessage, X…) never run JavaScript, so the
// only thing they can read is the HTML the server sends for the exact URL that
// was shared. These builders produce the per-page <title>, description, Open
// Graph and Twitter Card tags, and splice them into a copy of the built
// index.html. scripts/render-share-pages.mjs writes one such copy per Episode
// Page and Essay Page; the SPA boots from it exactly as it does from index.html.
//
// Pure: no DOM, no network. Safe under `node --test`.

import { normalizeDescription } from './description-normalizer.js';
import { parseShowNotes } from './episode-notes.js';
import { artworkUrl, ARTWORK_WIDTH } from './artwork-url.js';
import { resolveCoverImage } from './essay-cover.js';

export const SITE_ORIGIN = 'https://cinemaslime.com';
export const SITE_NAME = 'Cinema Slime Podcast';
export const SHOW_ART = 'https://d3t3ozftmdmh3i.cloudfront.net/staging/podcast_uploaded_nologo/43698817/43698817-1757516582372-2a574ca9eaf8e.jpg';
const FALLBACK_DESCRIPTION = 'Experience movies with us! Deep dives, hot takes, and slimey ratings on the films that matter.';

// Unfurlers cut descriptions at roughly 200–300 characters; ending on our own
// word boundary reads better than their mid-word cut.
const DESCRIPTION_MAX = 200;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cleanTitle(title) {
  return String(title || '').replace(/\s*\|\s*Cinema Slime Podcast.*$/i, '')
    .replace(/\s*x\s*Cinema Slime Podcast.*$/i, '')
    .replace(/\s*Review & Deep Dive.*$/i, '')
    .trim();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html) {
  const spaced = String(html || '').replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, ' ');
  return decodeEntities(spaced.replace(/<[^>]*>/g, ''))
    .replace(/(^|\s)[*•]+(?=\s|$)/g, '$1') // stray bullet marks some notes open with
    .replace(/\s+/g, ' ')
    .trim();
}

// Long-form Nostr bodies are Markdown. Enough of it is stripped that the
// opening sentences read as plain prose; anything missed is merely cosmetic.
export function markdownToText(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // links -> their text
    .replace(/<[^>]*>/g, ' ')                         // inline HTML
    .replace(/https?:\/\/\S+|nostr:\S+/g, ' ')        // bare URLs and nostr refs
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')          // headings ("Summary", "Synopsis") are labels, not prose
    .replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, '')   // quote and list marks
    .replace(/[*_~`]+/g, '')                          // emphasis and code marks
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(text, max = DESCRIPTION_MAX) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const atWord = cut.replace(/\s+\S*$/, '');
  return (atWord.length > max * 0.6 ? atWord : cut).replace(/[\s,;:.–—-]+$/, '') + '…';
}

// "S2E19" when the feed numbers the Episode; Bonus/Trailer otherwise.
export function episodeTag(ep) {
  if (ep?.episodeType === 'bonus') return 'Bonus';
  if (ep?.episodeType === 'trailer') return 'Trailer';
  if (!ep?.episode) return '';
  return ep.season ? `S${ep.season}E${ep.episode}` : `E${ep.episode}`;
}

function absolute(url, origin) {
  return /^https?:\/\//i.test(url) ? url : origin + url;
}

/**
 * The Link Preview of one Episode Page.
 * @returns {{ path, url, title, documentTitle, description, image, imageAlt, type }}
 */
export function episodeShareMeta(ep, origin = SITE_ORIGIN) {
  const name = cleanTitle(ep.title) || 'Episode';
  const tag = episodeTag(ep);
  const { cleanedHtml } = normalizeDescription(ep.description || '');
  const notes = parseShowNotes(cleanedHtml, ep.duration);
  const billing = notes.billing
    ? [notes.billing.label, notes.billing.theme].filter(Boolean).join(' x ')
    : '';
  const lead = htmlToText(notes.proseHtml) || notes.quote;
  const description = truncate([billing, lead].filter(Boolean).join(' — ')) || FALLBACK_DESCRIPTION;
  const path = `/episode/${encodeURIComponent(ep.guid.trim())}`;
  return {
    path,
    url: origin + path,
    title: tag ? `${name} · ${tag}` : name,
    documentTitle: `${name} | Cinema Slime Podcast`,
    description,
    image: absolute(artworkUrl(ep.image || SHOW_ART, ARTWORK_WIDTH.POSTER), origin),
    imageAlt: `Cover art for ${name}`,
    type: 'article',
  };
}

/**
 * The Link Preview of one Essay Page. The canonical URL is the Essay Slug when
 * the brand designated one, else the coordinate.
 * @param {{ coordinate: string, essay: object, slug?: string }} entry  a Discovery entry
 */
export function essayShareMeta({ coordinate, essay, slug }, origin = SITE_ORIGIN) {
  const name = (essay.title || '').trim() || 'Essay';
  const author = (essay.authorName || '').trim();
  const lead = (essay.summary || '').trim() || markdownToText(essay.body);
  const cover = resolveCoverImage(essay);
  const path = `/essay/${encodeURIComponent(slug || coordinate)}`;
  return {
    path,
    url: origin + path,
    title: author ? `${name} — by ${author}` : name,
    documentTitle: `${name} | Cinema Slime`,
    description: truncate(lead) || FALLBACK_DESCRIPTION,
    image: cover && /^https:\/\//i.test(cover) ? cover : SHOW_ART,
    imageAlt: cover ? `Cover image for ${name}` : 'Cinema Slime Podcast',
    type: 'article',
  };
}

// Tags this module owns. Every one is removed from the template before the
// page's own are written, so injecting into an already-injected page (the
// scheduled refresh uses the live page as its template) never duplicates them.
const OWNED_TAG = /[ \t]*<(meta\s[^>]*(?:name|property)="(?:description|og:[^"]*|twitter:[^"]*)"[^>]*|link\s[^>]*rel="canonical"[^>]*)>[ \t]*\r?\n?/gi;

export function buildShareMetaHtml(meta) {
  const e = (v) => escapeHtml(v);
  return [
    `<meta name="description" content="${e(meta.description)}" />`,
    `<link rel="canonical" href="${e(meta.url)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${e(meta.type)}" />`,
    `<meta property="og:url" content="${e(meta.url)}" />`,
    `<meta property="og:title" content="${e(meta.title)}" />`,
    `<meta property="og:description" content="${e(meta.description)}" />`,
    `<meta property="og:image" content="${e(meta.image)}" />`,
    `<meta property="og:image:alt" content="${e(meta.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${e(meta.title)}" />`,
    `<meta name="twitter:description" content="${e(meta.description)}" />`,
    `<meta name="twitter:image" content="${e(meta.image)}" />`,
  ].map((line) => `    ${line}\n`).join('');
}

/** A copy of the built index.html carrying `meta` as its Link Preview. */
export function injectShareMeta(templateHtml, meta) {
  if (!/<\/head>/i.test(templateHtml)) throw new Error('injectShareMeta: template has no </head>');
  return templateHtml
    .replace(OWNED_TAG, '')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.documentTitle)}</title>`)
    .replace(/([ \t]*)<\/head>/i, (_, indent) => `${buildShareMetaHtml(meta)}${indent}</head>`);
}

// The decoded path segment becomes a directory name on the droplet, and nginx
// matches it against the decoded request path. Anything outside this
// conservative alphabet is skipped — its page still works, it just unfurls
// with the site-wide preview.
export function isSafeSegment(segment) {
  return typeof segment === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(segment);
}
