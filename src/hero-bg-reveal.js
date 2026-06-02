/**
 * Wires per-tile fuzzy-reveal listeners for the Discovery View hero background.
 *
 * For each .hero-bg-tile-wrap that contains an img.hero-bg-tile:
 *  - Calls img.decode() so the .loaded class is added only after the browser
 *    confirms the image is fully decoded (no flash of partial/broken artwork).
 *  - img.decode() rejection is silently swallowed; the tile keeps its dark
 *    placeholder indefinitely — no broken or half-faded state.
 *
 * Idempotent: a img already marked with dataset.revealWired is skipped, so
 * calling this function more than once (e.g. on hash-back navigation) is safe.
 *
 * @param {Object} [root=document]  Any object exposing querySelectorAll — pass
 *   a mock for unit tests, omit to target the live document.
 */
export function revealHeroBgTiles(root = document) {
  root.querySelectorAll('.hero-bg-tile-wrap').forEach(wrap => {
    const img = wrap.querySelector('img.hero-bg-tile');
    if (!img || img.dataset.revealWired) return;
    img.dataset.revealWired = '1';
    img.decode().then(
      () => img.classList.add('loaded'),
      () => { /* image never decoded — keep dark placeholder forever */ }
    );
  });
}
