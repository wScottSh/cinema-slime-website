/**
 * Fuzzy-reveals each real Episode artwork tile in the Discovery View hero
 * background once the browser has fully decoded it.
 *
 * For every img.hero-bg-tile:
 *  - Calls img.decode() and adds the .loaded class once the artwork is ready,
 *    so it fades in without flashing partial/broken pixels.
 *  - decode() can reject *transiently*: a loading="lazy" tile that is offscreen
 *    (below the fold) when this runs — e.g. on a refresh that restores scroll, or
 *    a warm-cache reload — rejects even though the image loads fine moments later.
 *    Treating that rejection as permanent left whole swaths of below-the-fold
 *    tiles stuck as dark placeholders forever, because the dataset.revealWired
 *    guard meant the tile was never reconsidered. So on rejection we fall back to
 *    the image's load state: reveal immediately if it is already loaded, else
 *    reveal once it finally fires 'load'. A genuinely broken image never loads
 *    (fires 'error' instead) and correctly keeps its dark placeholder.
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

    const reveal = () => {
      // Force a reflow so the opacity:0 placeholder state is committed before
      // .loaded flips it to opacity:1. Without this, an already-cached image
      // (e.g. on back navigation) decodes synchronously and the browser
      // collapses both states into one frame, skipping the fade-in transition.
      void img.offsetWidth;
      img.classList.add('loaded');
    };

    img.decode().then(reveal, () => {
      // Transient decode rejection (offscreen lazy tile). Don't give up: reveal
      // when the image is actually loaded.
      if (img.complete && img.naturalWidth > 0) reveal();
      else img.addEventListener('load', reveal, { once: true });
    });
  });
}
