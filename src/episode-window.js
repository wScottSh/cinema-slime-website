// Pure windowing policy: given an episode list, an expanded flag, and a cap,
// return the visible slice and metadata for rendering the "Show all" button.
// No DOM, no globals — data in, verdict out.
export function applyWindow(list, expanded, cap) {
  const totalCount = list.length;
  if (totalCount === 0) return { visible: [], hasMore: false, totalCount: 0 };
  if (expanded || totalCount <= cap) return { visible: list, hasMore: false, totalCount };
  return { visible: list.slice(0, cap), hasMore: true, totalCount };
}

// Returns the first newly-revealed focusable element after expanding the
// episode window: the element at index `cap` in the full links list.
// Returns null when the list has no element at that index (nothing new shown).
export function findFocusTarget(links, cap) {
  if (!links || links.length <= cap) return null;
  return links[cap];
}
