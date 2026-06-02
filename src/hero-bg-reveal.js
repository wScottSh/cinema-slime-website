/**
 * Fuzzy-reveals each real Episode artwork tile in the Discovery View hero
 * background once the browser has fully decoded it.
 *
 * For every img.hero-bg-tile:
 *  - Calls img.decode() and adds the .loaded class only after decode resolves,
 *    so the artwork fades in without flashing partial/broken pixels.
 *  - If decode() rejects (failed/missing image) the class is never added and
 *    the tile keeps its dark placeholder — no broken or half-faded state.
 *
 * Idempotent: an img already marked with dataset.revealWired is skipped, so
 * calling this more than once (e.g. on hash-back navigation) is safe.
 *
 * @param {Object} [root=document]  Any object exposing querySelectorAll — pass
 *   a mock for unit tests, omit to target the live document.
 */
export function revealHeroBgTiles(root = document) {
  root.querySelectorAll('img.hero-bg-tile').forEach(img => {
    if (img.dataset.revealWired) return;
    img.dataset.revealWired = '1';
    img.decode().then(
      () => {
        // Force a reflow so the opacity:0 placeholder state is committed before
        // .loaded flips it to opacity:1. Without this, an already-cached image
        // (e.g. on back navigation) decodes synchronously and the browser
        // collapses both states into one frame, skipping the fade-in transition.
        void img.offsetWidth;
        img.classList.add('loaded');
      },
      () => { /* never decoded — keep the dark placeholder */ }
    );
  });
}
