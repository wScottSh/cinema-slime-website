/**
 * Fades the Discovery View hero film-reel background in as a single unit once
 * its first frames have decoded, so the reel appears cleanly rather than with
 * individual frames popping in. (With cover art now served from a warm cache,
 * per-frame fade choreography is no longer needed and reads as noise.)
 *
 * For each .hero-bg-tiles layer:
 *  - Waits for the first few frame images to decode (they sit near the visible
 *    centre), then adds the .reel-loaded class to fade the whole layer in.
 *  - A timeout fallback guarantees the layer is never left hidden — decode() can
 *    reject for offscreen/lazy frames, and Promise.allSettled swallows those, so
 *    the reveal never hangs on a slow or broken image.
 *  - Reads offsetWidth before adding the class so the initial opacity:0 state is
 *    committed and the CSS transition actually fires (e.g. on back navigation
 *    when images decode synchronously from cache).
 *
 * Idempotent: a layer already marked with dataset.reelRevealed is skipped, so
 * calling this again (hash-back navigation, resize rebuilds) is safe and never
 * re-triggers the fade.
 *
 * @param {Object} [root=document]  Any object exposing querySelectorAll — pass a
 *   mock for unit tests, omit to target the live document.
 */
export function revealHeroBg(root = document) {
  root.querySelectorAll('.hero-bg-tiles').forEach(layer => {
    if (layer.dataset.reelRevealed) return;
    layer.dataset.reelRevealed = '1';

    const show = () => {
      void layer.offsetWidth; // commit opacity:0 so the transition fires
      layer.classList.add('reel-loaded');
    };

    const imgs = Array.from(layer.querySelectorAll('img.hero-reel-art-img')).slice(0, 8);
    if (!imgs.length) {
      show();
      return;
    }

    let shown = false;
    const showOnce = () => {
      if (shown) return;
      shown = true;
      show();
    };
    Promise.allSettled(imgs.map(img => img.decode())).then(showOnce);
    setTimeout(showOnce, 1200); // fallback: never leave the layer hidden
  });
}
