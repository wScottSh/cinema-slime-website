export function normalizeDescription(rawHtml) {
  const raw = typeof rawHtml === 'string' ? rawHtml : '';
  if (!raw) {
    return { cleanedHtml: '', rawHtml: raw };
  }

  let cleaned = raw;

  // Strip trailing boilerplate aggressively using index search (reliable on real RSS HTML).
  // Markers never appear in actual episode prose/timestamps.
  const boilerMarkers = [
    'EXPERIENCE MOVIES WITH US!',
    'Subscribe to the',
    'Hosts: Harrison',
  ];

  let cutAt = -1;
  for (const marker of boilerMarkers) {
    const idx = cleaned.indexOf(marker);
    if (idx !== -1) {
      // Cut from the start of the nearest preceding <p> block for clean HTML
      const pStart = cleaned.lastIndexOf('<p', idx);
      cutAt = pStart !== -1 ? pStart : idx;
      break;
    }
  }
  if (cutAt !== -1) {
    cleaned = cleaned.substring(0, cutAt);
  }

  // Clean trailing structural noise while preserving meaningful content
  cleaned = cleaned.replace(/[\s\n\r]+$/g, '');
  cleaned = cleaned.replace(/(<p>\s*(<br\s*\/?>\s*|\s)*<\/p>\s*)+$/gi, '');
  cleaned = cleaned.replace(/(<br\s*\/?>\s*)+$/gi, '');
  cleaned = cleaned.replace(/<p>\s*<\/p>\s*$/gi, '');
  cleaned = cleaned.trim();

  // Defensive: remove any dangling open tags left by aggressive cuts
  cleaned = cleaned.replace(/<p[^>]*>\s*$/i, '');
  cleaned = cleaned.replace(/<strong[^>]*>\s*$/i, '');

  return { cleanedHtml: cleaned, rawHtml: raw };
}
