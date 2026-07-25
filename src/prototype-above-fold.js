// =============================================================================
// PROTOTYPE — THROWAWAY CODE. DO NOT SHIP.
//
// Question: what should the above-the-fold foreground of the Discovery View
// look like, now that (a) the wordmark lives inside the full logo image and
// (b) the film-reel background makes the old translucent cards read as mush?
//
// Five variants of the hero foreground on the existing landing page,
// switchable via `?variant=` and a floating bottom bar. The scrolling film-reel
// background is deliberately untouched in every variant.
//
// Settled in ALL variants (not the thing under test):
//   - nav drops the logo image, keeps the CINEMA SLIME wordmark text
//   - hero drops the typed CINEMA / SLIME <h1> in favour of the full logo image
//
// Under test: how Episodes and Essays are presented above the fold. Every
// variant is artwork-led; Essays are subordinate to Episodes but always carry
// an image.
//
// Fold the winner into main.js / style.css properly; delete this file.
// =============================================================================

import { buildEpisodeHash, buildEssayHash } from './router.js';
import { resolveCoverImage, buildFilmLeaderHtml } from './essay-cover.js';

export const PROTO_VARIANTS = [
  { key: 'X', name: 'Baseline (today, new logo)' },
  { key: 'A', name: 'Marquee banner' },
  { key: 'B', name: 'Poster deck' },
  { key: 'C', name: 'Contact-sheet mosaic' },
  { key: 'D', name: 'Projector split' },
];

const DEFAULT_VARIANT = 'X';

export function getProtoVariant(search = window.location.search) {
  const key = (new URLSearchParams(search).get('variant') || '').toUpperCase();
  return PROTO_VARIANTS.some(v => v.key === key) ? key : DEFAULT_VARIANT;
}

/* ============================ shared bits ============================ */

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The full logo now carries the wordmark, so no typed title anywhere.
function brandingHtml(ctx, { size = 'lg', tagline = true, hosts = true } = {}) {
  return `
    <div class="pv-branding pv-branding--${size}">
      <img class="pv-logo" src="${ctx.logo}" alt="Cinema Slime Podcast" />
      ${tagline ? `<p class="pv-tagline">Every month we randomly pick 4 films to watch and discuss. Deep dives, hot takes, and slimey ratings.</p>` : ''}
      ${hosts ? `<p class="pv-hosts">Harrison Jensen · Renn Jensen · Scott Sheppard</p>` : ''}
    </div>`;
}

function essayArtHtml(essay, className) {
  const url = resolveCoverImage(essay);
  const leader = buildFilmLeaderHtml(essay.title || '');
  const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()" />` : '';
  return `<div class="${className}">${leader}${img}</div>`;
}

function essayList(ctx, n) {
  return Array.isArray(ctx.essays) ? ctx.essays.slice(0, n) : [];
}

function essayDate(unixSeconds, ctx) {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fullEpisodes(ctx, n) {
  const eps = ctx.episodes || [];
  const full = eps.filter(e => e.episodeType === 'full');
  return (full.length ? full : eps).slice(0, n);
}

function latestOf(ctx) {
  const eps = ctx.episodes || [];
  const latest = eps.find(e => e.episodeType === 'full') || eps[0];
  return latest ? { ep: latest, idx: eps.indexOf(latest) } : null;
}

function loadingHtml(label = 'LOADING EPISODES…') {
  return `<div class="pv-loading">${label}</div>`;
}

/* ============================ variant X — baseline ============================
   Today's layout, untouched except for the two settled changes. The control. */

function heroX(ctx) {
  return `${brandingHtml(ctx)}<div id="hero-dynamic">${dynamicX(ctx)}</div>`;
}

function dynamicX(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  const { cleanTitle, formatDate, getEpLabel, getShortDescription } = ctx.helpers;
  const essays = essayList(ctx, 1);
  const spotlight = essays.length ? (() => {
    const { essay, slug, coordinate } = essays[0];
    return `<a href="${buildEssayHash(slug || coordinate)}" class="pv-x-essay" data-essay="1">
      ${essayArtHtml(essay, 'pv-x-essay-art')}
      <div class="pv-x-essay-body">
        <p class="pv-eyebrow">LATEST ESSAY</p>
        <h3>${esc(essay.title)}</h3>
        <p class="pv-x-essay-meta">${essay.authorName ? 'by ' + esc(essay.authorName) + ' · ' : ''}${essayDate(essay.publishedAt, ctx)}</p>
      </div>
    </a>`;
  })() : '';

  if (!latest) return `<p class="pv-count">NO EPISODES</p>${spotlight}`;
  const { ep, idx } = latest;
  return `
    <div class="pv-x-latest" data-idx="${idx}" data-open="${esc(ep.guid)}">
      <div class="pv-x-latest-art">
        <img src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" />
        <span class="pv-badge">LATEST EPISODE</span>
      </div>
      <div class="pv-x-latest-info">
        <span class="pv-eyebrow">${esc(getEpLabel(ep))}</span>
        <h2>${esc(cleanTitle(ep.title))}</h2>
        <span class="pv-x-latest-date">${formatDate(ep.pubDate)} · ${esc(ep.duration || '')}</span>
        <p class="pv-x-latest-desc">${esc(getShortDescription(ep.description))}</p>
        <div class="pv-cta-row">
          <button class="pv-btn pv-btn--primary" data-play="${idx}">▶ Play Now</button>
          <a class="pv-btn pv-btn--ghost" href="${ctx.social.youtube.url}" target="_blank" rel="noopener">YouTube</a>
          <a class="pv-btn pv-btn--ghost" href="${ctx.social.spotify.url}" target="_blank" rel="noopener">Spotify</a>
        </div>
      </div>
    </div>
    <p class="pv-count">${(ctx.episodes || []).length} EPISODES AND COUNTING</p>
    ${spotlight}`;
}

/* ============================ variant A — marquee banner =====================
   The latest Episode as a cinema marquee: its own artwork, blown up and
   bled edge-to-edge, IS the panel. No translucent card floating on the reel —
   opaque artwork punches through the background instead of competing with it.
   Essays trail underneath as a low-contrast reading rail: image-bearing, but
   a fraction of the size and weight of the marquee. */

function heroA(ctx) {
  return `${brandingHtml(ctx, { size: 'md' })}<div id="hero-dynamic">${dynamicA(ctx)}</div>`;
}

function dynamicA(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const latest = latestOf(ctx);
  const { cleanTitle, formatDate, getEpLabel, getShortDescription } = ctx.helpers;
  const rail = essayList(ctx, 4).map(({ essay, slug, coordinate }) => `
    <a class="pv-a-essay" href="${buildEssayHash(slug || coordinate)}" data-essay="1">
      ${essayArtHtml(essay, 'pv-a-essay-art')}
      <span class="pv-a-essay-title">${esc(essay.title)}</span>
      <span class="pv-a-essay-meta">${essay.authorName ? esc(essay.authorName) : 'Cinema Slime'}</span>
    </a>`).join('');
  const railHtml = rail ? `
    <div class="pv-a-rail">
      <p class="pv-rail-label">Also reading — Essays</p>
      <div class="pv-a-rail-items">${rail}</div>
    </div>` : '';

  if (!latest) return railHtml;
  const { ep, idx } = latest;
  return `
    <div class="pv-a-marquee" data-idx="${idx}" data-open="${esc(ep.guid)}">
      <div class="pv-a-bleed" style="background-image:url('${esc(ep.image)}')"></div>
      <div class="pv-a-scrim"></div>
      <div class="pv-a-inner">
        <div class="pv-a-poster"><img src="${esc(ep.image)}" alt="${esc(cleanTitle(ep.title))}" /></div>
        <div class="pv-a-copy">
          <p class="pv-eyebrow">Latest Episode · ${esc(getEpLabel(ep))}</p>
          <h2 class="pv-a-title">${esc(cleanTitle(ep.title))}</h2>
          <p class="pv-a-meta">${formatDate(ep.pubDate)} · ${esc(ep.duration || '')} · ${(ctx.episodes || []).length} episodes and counting</p>
          <p class="pv-a-desc">${esc(getShortDescription(ep.description))}</p>
          <div class="pv-cta-row">
            <button class="pv-btn pv-btn--primary pv-btn--big" data-play="${idx}">${ctx.icons.play} Play episode</button>
            <span class="pv-a-link" data-open-link="1">Show notes →</span>
          </div>
        </div>
      </div>
    </div>
    ${railHtml}`;
}

/* ============================ variant B — poster deck ========================
   No panel at all: a deck of Episode covers at poster scale, the focused one
   large and lit, its neighbours receding into the reel. Everything you need to
   know is one line of type under the art. Essays live in the right margin as a
   narrow marginalia column — text-led rows with a small cover chip, so they
   read as footnotes to the posters rather than peers of them.
   Clicking a flanking poster refocuses the deck (in-memory only). */

let deckFocus = 0;

function heroB(ctx) {
  return `${brandingHtml(ctx, { size: 'sm', hosts: false })}<div id="hero-dynamic">${dynamicB(ctx)}</div>`;
}

function dynamicB(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const { cleanTitle, formatDate, getEpLabel } = ctx.helpers;
  const deck = fullEpisodes(ctx, 7);
  if (!deck.length) return '';
  if (deckFocus >= deck.length) deckFocus = 0;
  const focused = deck[deckFocus];
  const focusedIdx = (ctx.episodes || []).indexOf(focused);

  const posters = deck.map((ep, i) => {
    const dist = Math.abs(i - deckFocus);
    return `<button class="pv-b-poster${i === deckFocus ? ' is-focus' : ''}" data-deck="${i}"
      style="--dist:${Math.min(dist, 3)}" aria-label="${esc(cleanTitle(ep.title))}">
      <img src="${esc(ep.image)}" alt="" loading="lazy" />
    </button>`;
  }).join('');

  const margin = essayList(ctx, 4).map(({ essay, slug, coordinate }) => `
    <a class="pv-b-essay" href="${buildEssayHash(slug || coordinate)}" data-essay="1">
      ${essayArtHtml(essay, 'pv-b-essay-chip')}
      <span class="pv-b-essay-text">
        <span class="pv-b-essay-title">${esc(essay.title)}</span>
        <span class="pv-b-essay-meta">${essay.authorName ? esc(essay.authorName) + ' · ' : ''}${essayDate(essay.publishedAt, ctx)}</span>
      </span>
    </a>`).join('');

  return `
    <div class="pv-b-wrap">
      <div class="pv-b-main">
        <div class="pv-b-deck">${posters}</div>
        <div class="pv-b-caption" data-idx="${focusedIdx}" data-open="${esc(focused.guid)}">
          <button class="pv-b-play" data-play="${focusedIdx}" aria-label="Play">${ctx.icons.play}</button>
          <span class="pv-b-caption-text">
            <span class="pv-eyebrow">${esc(getEpLabel(focused))}</span>
            <span class="pv-b-title" data-open-link="1">${esc(cleanTitle(focused.title))}</span>
            <span class="pv-b-meta">${formatDate(focused.pubDate)} · ${esc(focused.duration || '')}</span>
          </span>
        </div>
        <p class="pv-count">${(ctx.episodes || []).length} episodes and counting</p>
      </div>
      ${margin ? `<aside class="pv-b-margin">
        <p class="pv-rail-label">Essays</p>
        ${margin}
      </aside>` : ''}
    </div>`;
}

/* ============================ variant C — contact-sheet mosaic ===============
   The whole fold is artwork: one asymmetric grid of covers, no cards, no
   panels, titles burned into the bottom of each tile. The latest Episode is a
   2x2 hero tile; recent Episodes fill the rest at half size. Essays occupy two
   wide short tiles at the foot of the sheet — same grid, but desaturated,
   letter-boxed and tagged, so they are visibly a different, quieter kind. */

function heroC(ctx) {
  return `${brandingHtml(ctx, { size: 'sm', hosts: false })}<div id="hero-dynamic">${dynamicC(ctx)}</div>`;
}

function dynamicC(ctx) {
  if (ctx.episodes === undefined) return loadingHtml();
  const { cleanTitle, formatDate, getEpLabel } = ctx.helpers;
  const eps = fullEpisodes(ctx, 5);
  if (!eps.length) return '';
  const all = ctx.episodes || [];

  const tiles = eps.map((ep, i) => {
    const idx = all.indexOf(ep);
    return `<a class="pv-c-tile${i === 0 ? ' pv-c-tile--hero' : ''}" href="${buildEpisodeHash(ep.guid)}"
      data-idx="${idx}" data-open="${esc(ep.guid)}">
      <img src="${esc(ep.image)}" alt="" loading="lazy" />
      <span class="pv-c-tile-scrim"></span>
      ${i === 0 ? `<span class="pv-badge">LATEST</span>` : ''}
      <span class="pv-c-tile-copy">
        <span class="pv-eyebrow">${esc(getEpLabel(ep))}</span>
        <span class="pv-c-tile-title">${esc(cleanTitle(ep.title))}</span>
        ${i === 0 ? `<span class="pv-c-tile-meta">${formatDate(ep.pubDate)} · ${esc(ep.duration || '')}</span>` : ''}
      </span>
      ${i === 0 ? `<button class="pv-c-play" data-play="${idx}" aria-label="Play">${ctx.icons.play}</button>` : ''}
    </a>`;
  }).join('');

  const essayTiles = essayList(ctx, 2).map(({ essay, slug, coordinate }) => `
    <a class="pv-c-essay" href="${buildEssayHash(slug || coordinate)}" data-essay="1">
      ${essayArtHtml(essay, 'pv-c-essay-art')}
      <span class="pv-c-essay-copy">
        <span class="pv-eyebrow pv-eyebrow--muted">Essay</span>
        <span class="pv-c-essay-title">${esc(essay.title)}</span>
        <span class="pv-c-essay-meta">${essay.authorName ? esc(essay.authorName) + ' · ' : ''}${essayDate(essay.publishedAt, ctx)}</span>
      </span>
    </a>`).join('');

  return `<div class="pv-c-sheet">${tiles}${essayTiles}</div>
    <p class="pv-count">${all.length} episodes and counting</p>`;
}

/* ============================ variant D — projector split ====================
   Half the fold is a single enormous piece of artwork bleeding off the edge —
   the image does all the work — and the other half is a typographic index:
   branding, then a numbered list of recent Episodes. Hovering or focusing a row
   throws that Episode's art onto the big panel, so the list stays text-light
   while the artwork stays huge. Essays close the column as a small "also
   reading" trio with circular cover chips: present, imaged, clearly minor. */

function heroD(ctx) {
  return `<div id="hero-dynamic">${dynamicD(ctx)}</div>`;
}

function dynamicD(ctx) {
  const { cleanTitle, formatDate, getEpLabel } = ctx.helpers;
  if (ctx.episodes === undefined) {
    return `<div class="pv-d-split"><div class="pv-d-stage"></div><div class="pv-d-col">${brandingHtml(ctx, { size: 'md', hosts: false })}${loadingHtml()}</div></div>`;
  }
  const eps = fullEpisodes(ctx, 6);
  const all = ctx.episodes || [];
  const first = eps[0];

  const rows = eps.map((ep, i) => {
    const idx = all.indexOf(ep);
    return `<a class="pv-d-row${i === 0 ? ' is-active' : ''}" href="${buildEpisodeHash(ep.guid)}"
      data-idx="${idx}" data-open="${esc(ep.guid)}" data-art="${esc(ep.image)}">
      <span class="pv-d-row-n">${String(i + 1).padStart(2, '0')}</span>
      <span class="pv-d-row-body">
        <span class="pv-d-row-title">${esc(cleanTitle(ep.title))}</span>
        <span class="pv-d-row-meta">${esc(getEpLabel(ep))} · ${formatDate(ep.pubDate)} · ${esc(ep.duration || '')}</span>
      </span>
      <button class="pv-d-row-play" data-play="${idx}" aria-label="Play">${ctx.icons.play}</button>
    </a>`;
  }).join('');

  const essays = essayList(ctx, 3).map(({ essay, slug, coordinate }) => `
    <a class="pv-d-essay" href="${buildEssayHash(slug || coordinate)}" data-essay="1">
      ${essayArtHtml(essay, 'pv-d-essay-chip')}
      <span class="pv-d-essay-title">${esc(essay.title)}</span>
    </a>`).join('');

  return `
    <div class="pv-d-split">
      <div class="pv-d-stage">
        <img class="pv-d-stage-img" id="pv-d-stage-img" src="${esc(first ? first.image : ctx.showArt)}" alt="" />
        <span class="pv-badge pv-badge--stage">LATEST EPISODE</span>
      </div>
      <div class="pv-d-col">
        ${brandingHtml(ctx, { size: 'md', hosts: false })}
        <p class="pv-rail-label">Recent episodes · ${all.length} and counting</p>
        <div class="pv-d-rows">${rows}</div>
        ${essays ? `<div class="pv-d-essays">
          <p class="pv-rail-label">Also reading</p>
          <div class="pv-d-essay-row">${essays}</div>
        </div>` : ''}
      </div>
    </div>`;
}

/* ============================ dispatch ============================ */

const BUILDERS = {
  X: { hero: heroX, dynamic: dynamicX },
  A: { hero: heroA, dynamic: dynamicA },
  B: { hero: heroB, dynamic: dynamicB },
  C: { hero: heroC, dynamic: dynamicC },
  D: { hero: heroD, dynamic: dynamicD },
};

export function buildProtoHeroContent(variant, ctx) {
  return (BUILDERS[variant] || BUILDERS[DEFAULT_VARIANT]).hero(ctx);
}

export function buildProtoHeroDynamic(variant, ctx) {
  return (BUILDERS[variant] || BUILDERS[DEFAULT_VARIANT]).dynamic(ctx);
}

/* One delegated handler covers every variant: [data-play] plays, [data-open]
   opens the Episode Page, [data-essay] anchors are left alone for the router. */
export function bindProtoHero(variant, ctx) {
  const hero = document.getElementById('hero');
  if (!hero) return;

  // The click handler is delegated on #hero, which survives hero-dynamic
  // re-renders — so attach it exactly once.
  if (hero.dataset.pvBound) { bindProtoStage(variant, hero); return; }
  hero.dataset.pvBound = '1';

  hero.addEventListener('click', (e) => {
    const playEl = e.target.closest('[data-play]');
    if (playEl) {
      e.preventDefault();
      e.stopPropagation();
      ctx.play(parseInt(playEl.dataset.play, 10));
      return;
    }
    const deckEl = e.target.closest('[data-deck]');
    if (deckEl) {
      e.preventDefault();
      deckFocus = parseInt(deckEl.dataset.deck, 10);
      ctx.refreshDynamic();
      return;
    }
    if (e.target.closest('[data-essay]')) return; // let the hash router handle it
    const openEl = e.target.closest('[data-open]');
    if (openEl) {
      e.preventDefault();
      ctx.openEpisode(openEl.dataset.open);
    }
  });

  bindProtoStage(variant, hero);
}

// Variant D only: hovering/focusing an Episode row throws its art onto the
// big stage. Re-bound on every hero-dynamic re-render (fresh rows each time).
function bindProtoStage(variant, hero) {
  if (variant !== 'D') return;
  const stage = document.getElementById('pv-d-stage-img');
  if (!stage) return;
  hero.querySelectorAll('.pv-d-row').forEach(row => {
    const swap = () => {
      stage.src = row.dataset.art;
      hero.querySelectorAll('.pv-d-row').forEach(r => r.classList.toggle('is-active', r === row));
    };
    row.addEventListener('mouseenter', swap);
    row.addEventListener('focus', swap);
  });
}

/* ============================ the switcher bar ============================ */

export function buildProtoSwitcherHtml(variant) {
  const i = PROTO_VARIANTS.findIndex(v => v.key === variant);
  const cur = PROTO_VARIANTS[i] || PROTO_VARIANTS[0];
  return `
    <div class="pv-switch" id="pv-switch">
      <button class="pv-switch-arrow" data-step="-1" aria-label="Previous variant">←</button>
      <span class="pv-switch-label"><b>${cur.key}</b> — ${esc(cur.name)}</span>
      <button class="pv-switch-arrow" data-step="1" aria-label="Next variant">→</button>
    </div>`;
}

let switcherKeysBound = false;

export function bindProtoSwitcher(variant) {
  const go = (step) => {
    const i = PROTO_VARIANTS.findIndex(v => v.key === variant);
    const next = PROTO_VARIANTS[(i + step + PROTO_VARIANTS.length) % PROTO_VARIANTS.length].key;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.location.href = url.toString(); // full reload — cheapest way to re-render everything
  };
  document.querySelectorAll('#pv-switch [data-step]').forEach(btn => {
    btn.addEventListener('click', () => go(parseInt(btn.dataset.step, 10)));
  });
  if (switcherKeysBound) return;
  switcherKeysBound = true;
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });
}
