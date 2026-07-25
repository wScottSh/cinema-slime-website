// PROTOTYPE — THROWAWAY. Below-the-fold styling variants.
//
// Question this answers:
//   The above-the-fold foreground was rebuilt into a back-alley paste-up
//   register (ADR 0011). The bottom of the site — About Cinema Slime,
//   Subscribe & Follow, the footer nav and the copyright line — is still the
//   original rounded-card, centered-header, 50px-radius-pill website. It reads
//   as a different site. What should the bottom become so it belongs to the
//   same object as the fold?
//
// Under test, switchable via ?variant= and a dev-only floating bottom bar:
//   X  baseline — today's About / Subscribe / footer. The control.
//   A  BACK ALLEY WALL  — the fold's own register, continued: torn paper,
//      tape, halftone, polaroid crew cards, ticket-stub links, film-leader
//      footer. The conservative answer: more of what already works.
//   B  PHOTOCOPIED ZINE — inverts the ground. The bottom third becomes a
//      light, xeroxed zine page: newsprint columns, a stencil drop cap, a
//      numbered index of platforms, ransom-note footer. Loud, and a real break.
//   C  END CREDITS      — no panels at all. The bottom is the credit roll:
//      right-aligned role labels against left-aligned names, dot leaders, a
//      countdown-leader slate for the copyright. Quiet and typographic.
//   D  MARQUEE BOARD    — the theatre out front: a lit marquee with bulb
//      rails, the crew as a bill of players, platforms as marquee letters,
//      a box-office footer.
//
// Settled in every variant (not under test):
//   - The section ids #about and #subscribe stay, because the nav links to them.
//   - Grunge is CSS + SVG filters only, no image assets (ADR 0011 decision 4).
//   - The torn-edge displacement is applied to a paper layer beneath the type,
//     never to type itself.
//   - The centered "label / TITLE / red divider" header stack is gone from every
//     variant except the control. It is the single loudest tell that the bottom
//     was built to a different spec than the fold.
//
// Delete this file, prototype-bottom.css, and the call sites marked PROTOTYPE
// in main.js once a winner is folded in.

const VARIANTS = ['X', 'A', 'B', 'C', 'D'];

export function getProtoVariant() {
  const v = new URLSearchParams(window.location.search).get('variant');
  return VARIANTS.includes((v || '').toUpperCase()) ? v.toUpperCase() : 'X';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ========================= shared content =========================
   Lifted verbatim from renderAbout/renderSubscribe/renderFooter so the
   variants differ in treatment only, never in what they say. */

const ABOUT_PARAS = [
  `<span class="pb-red">Cinema Slime</span> is the podcast where film obsession gets
   <span class="pb-slime">gloriously messy</span>. Every month, hosts Harrison, Renn &amp;
   Scott randomly draw from personalized category lists and dive headfirst into the movies
   that shaped us.`,
  `From 1930s noir to 90s nostalgia bombs, from animation deep dives to space horror —
   no genre is safe from the <span class="pb-slime">slime treatment</span>.
   Each episode features unfiltered discussion, the legendary
   <span class="pb-red">Slimiest Scenes</span> segment, star ratings, and a live
   category lottery for the next month.`,
  `Whether you're here for the hot takes, the deep cuts, or just want to hear three
   friends argue about whether Vanilla Ice saved TMNT 2 — you're home.`,
];

const HOSTS = [
  { name: 'HARRISON JENSEN', role: 'Host · Producer', initials: 'HJ' },
  { name: 'RENN JENSEN', role: 'Host · Producer', initials: 'RJ' },
  { name: 'SCOTT SHEPPARD', role: 'Host · Producer', initials: 'SS' },
];

const EMAIL = 'cinemaslimepodcast@gmail.com';
const FOOTER_KEYS = ['youtube', 'spotify', 'patreon', 'discord', 'instagram'];

/* The <defs> the bottom sections filter against. Given their own ids rather
   than borrowing the hero's, so the bottom is self-contained and the footer
   still tears correctly on the Episode and Essay pages (where no hero renders). */
export function buildProtoDefsHtml() {
  return `<svg class="pb-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
    <filter id="pb-torn" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.03 0.06" numOctaves="5" seed="19" result="n" />
      <feGaussianBlur in="n" stdDeviation="0.7" result="sn" />
      <feDisplacementMap in="SourceGraphic" in2="sn" scale="20" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id="pb-torn-sm" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.05 0.09" numOctaves="5" seed="7" result="n" />
      <feGaussianBlur in="n" stdDeviation="0.6" result="sn" />
      <feDisplacementMap in="SourceGraphic" in2="sn" scale="10" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id="pb-ink" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.14 0.2" numOctaves="3" seed="5" result="n" />
      <feGaussianBlur in="n" stdDeviation="0.4" result="sn" />
      <feDisplacementMap in="SourceGraphic" in2="sn" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id="pb-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
  </defs></svg>`;
}

/* A section heading in the fold's register: stencil kicker, display line with a
   hard red offset, left-aligned. Replaces the centered label/title/divider. */
function heading(kicker, title, { align = 'left' } = {}) {
  return `<header class="pb-head pb-head--${align}">
    <p class="pb-stencil">${esc(kicker)}</p>
    <h2 class="pb-title">${esc(title)}</h2>
  </header>`;
}

function socialEntries(social) {
  return Object.entries(social);
}

/* ========================= A — BACK ALLEY WALL ========================= */

function buildA(ctx) {
  const { social, year } = ctx;
  const paras = ABOUT_PARAS.map((p) => `<p>${p}</p>`).join('');
  const crew = HOSTS.map((h, i) => `
    <div class="pbA-polaroid" style="--rot:${[-3, 2, -1.5][i]}deg">
      <span class="pbA-polaroid-plate">${esc(h.initials)}</span>
      <span class="pbA-polaroid-name">${esc(h.name)}</span>
      <span class="pbA-polaroid-role">${esc(h.role)}</span>
      <span class="pb-tape pb-tape--tl"></span>
    </div>`).join('');

  const stubs = socialEntries(social).map(([key, s], i) => `
    <a class="pbA-stub" href="${esc(s.url)}" target="_blank" rel="noopener" id="subscribe-${esc(key)}"
       style="--rot:${[-2, 1.5, -1, 2.2, -1.8, 1, -2.4, 1.6][i % 8]}deg">
      <span class="pbA-stub-paper"></span>
      <span class="pbA-stub-no">${String(i + 1).padStart(2, '0')}</span>
      <span class="pbA-stub-label">${esc(s.label)}</span>
      <span class="pbA-stub-perf" aria-hidden="true"></span>
    </a>`).join('');

  return `
    <section class="pb pb--a" id="about">
      <div class="pbA-wall" aria-hidden="true"></div>

      <div class="pbA-inner">
        ${heading('The crew', 'ABOUT CINEMA SLIME')}
        <div class="pbA-grid">
          <div class="pbA-broadsheet">
            <div class="pbA-paper">
              <div class="pbA-paper-scrim"></div>
            </div>
            <div class="pbA-halftone"></div>
            <div class="pbA-grain"></div>
            <div class="pbA-copy">${paras}
              <a href="${esc(social.discord.url)}" target="_blank" rel="noopener" class="pbA-cta">Join the Discord →</a>
            </div>
            <span class="pb-tape pb-tape--tl"></span>
            <span class="pb-tape pb-tape--br"></span>
          </div>
          <div class="pbA-crew">
            ${crew}
            <a class="pbA-email" href="mailto:${EMAIL}">${EMAIL}</a>
          </div>
        </div>
      </div>
    </section>

    <section class="pb pb--a pbA-subscribe" id="subscribe">
      <div class="pbA-inner">
        ${heading('Tune in', 'SUBSCRIBE & FOLLOW')}
        <p class="pbA-sub-note">Pick a wall. We're pasted on all of them.</p>
        <div class="pbA-stubs">${stubs}</div>
      </div>
    </section>

    ${buildFooterA(ctx, year)}
  `;
}

function buildFooterA({ social }, year) {
  const links = FOOTER_KEYS.map((k) => `
    <a href="${esc(social[k].url)}" target="_blank" rel="noopener">${esc(social[k].label)}</a>`).join('');
  return `
    <footer class="pb-footer pbA-footer">
      <div class="pbA-leader" aria-hidden="true">
        <span class="pbA-sprockets pbA-sprockets--l"></span>
        <span class="pbA-sprockets pbA-sprockets--r"></span>
      </div>
      <div class="pbA-footer-inner">
        <div class="pbA-footer-brand">CINEMA <span class="pb-slime-face">SLIME</span></div>
        <nav class="pbA-footer-links">${links}</nav>
        <p class="pbA-footer-copy">
          © ${year} Cinema Slime Productions · All rights reserved
          <span>Feed updated live from RSS · Powered by slime</span>
        </p>
      </div>
    </footer>`;
}

/* ========================= B — PHOTOCOPIED ZINE ========================= */

function buildB(ctx) {
  const { social, year } = ctx;
  // The first paragraph is split so the drop cap can own its first letter.
  const first = ABOUT_PARAS[0];
  const rest = ABOUT_PARAS.slice(1).map((p) => `<p>${p}</p>`).join('');

  const crew = HOSTS.map((h) => `
    <li class="pbB-crew-row">
      <span class="pbB-crew-name">${esc(h.name)}</span>
      <span class="pbB-crew-role">${esc(h.role)}</span>
    </li>`).join('');

  const rows = socialEntries(social).map(([key, s], i) => `
    <a class="pbB-row" href="${esc(s.url)}" target="_blank" rel="noopener" id="subscribe-${esc(key)}">
      <span class="pbB-row-no">${String(i + 1).padStart(2, '0')}</span>
      <span class="pbB-row-label">${esc(s.label)}</span>
      <span class="pbB-row-go">↗</span>
    </a>`).join('');

  return `
    <div class="pbB-sheet">
      <div class="pbB-toner" aria-hidden="true"></div>
      <div class="pbB-grain" aria-hidden="true"></div>

      <section class="pb pb--b" id="about">
        <div class="pbB-masthead">
          <span class="pbB-masthead-issue">Issue №${year - 2019} · Photocopied at cost</span>
          <h2 class="pbB-masthead-title">ABOUT CINEMA SLIME</h2>
          <span class="pbB-masthead-rule"></span>
        </div>
        <div class="pbB-columns">
          <p class="pbB-lead">${first}</p>
          ${rest}
          <p class="pbB-kicker">
            <a href="${esc(social.discord.url)}" target="_blank" rel="noopener">Join the Discord →</a>
          </p>
        </div>
        <aside class="pbB-box">
          <h3>THE MASTHEAD</h3>
          <ul class="pbB-crew">${crew}</ul>
          <a class="pbB-email" href="mailto:${EMAIL}">${EMAIL}</a>
        </aside>
      </section>

      <section class="pb pb--b pbB-index" id="subscribe">
        <div class="pbB-masthead pbB-masthead--tight">
          <span class="pbB-masthead-issue">Where to find us</span>
          <h2 class="pbB-masthead-title">SUBSCRIBE &amp; FOLLOW</h2>
          <span class="pbB-masthead-rule"></span>
        </div>
        <div class="pbB-rows">${rows}</div>
      </section>

      ${buildFooterB(ctx, year)}
    </div>
  `;
}

function buildFooterB({ social }, year) {
  const links = FOOTER_KEYS.map((k) => `
    <a href="${esc(social[k].url)}" target="_blank" rel="noopener">${esc(social[k].label)}</a>`).join('');
  return `
    <footer class="pb-footer pbB-footer">
      <div class="pbB-footer-brand">CINEMA <span>SLIME</span></div>
      <nav class="pbB-footer-links">${links}</nav>
      <p class="pbB-footer-copy">
        © ${year} Cinema Slime Productions. All rights reserved.<br />
        Feed updated live from RSS · Powered by slime
      </p>
    </footer>`;
}

/* ========================= C — END CREDITS ========================= */

function buildC(ctx) {
  const { social, year } = ctx;
  const paras = ABOUT_PARAS.map((p) => `<p>${p}</p>`).join('');
  const crew = HOSTS.map((h) => `
    <div class="pbC-credit">
      <span class="pbC-credit-role">${esc(h.role)}</span>
      <span class="pbC-credit-name">${esc(h.name)}</span>
    </div>`).join('');

  const dist = socialEntries(social).map(([key, s]) => `
    <a class="pbC-credit pbC-credit--link" href="${esc(s.url)}" target="_blank" rel="noopener" id="subscribe-${esc(key)}">
      <span class="pbC-credit-role">${esc(s.label)}</span>
      <span class="pbC-credit-name">Listen · Follow</span>
    </a>`).join('');

  return `
    <section class="pb pb--c" id="about">
      <div class="pbC-inner">
        <p class="pb-stencil pbC-slate">Production notes</p>
        <h2 class="pbC-title">ABOUT CINEMA SLIME</h2>
        <div class="pbC-body">
          <div class="pbC-prose">${paras}
            <a href="${esc(social.discord.url)}" target="_blank" rel="noopener" class="pbC-cta">Join the Discord →</a>
          </div>
          <div class="pbC-credits">
            <p class="pbC-credits-head">CAST &amp; CREW</p>
            ${crew}
            <div class="pbC-credit">
              <span class="pbC-credit-role">Correspondence</span>
              <span class="pbC-credit-name"><a href="mailto:${EMAIL}">${EMAIL}</a></span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="pb pb--c pbC-dist" id="subscribe">
      <div class="pbC-inner">
        <p class="pb-stencil pbC-slate">Distributed by</p>
        <h2 class="pbC-title">SUBSCRIBE &amp; FOLLOW</h2>
        <div class="pbC-credits pbC-credits--two">${dist}</div>
      </div>
    </section>

    ${buildFooterC(ctx, year)}
  `;
}

function buildFooterC({ social }, year) {
  const links = FOOTER_KEYS.map((k) => `
    <a href="${esc(social[k].url)}" target="_blank" rel="noopener">${esc(social[k].label)}</a>`).join('');
  return `
    <footer class="pb-footer pbC-footer">
      <div class="pbC-leader" aria-hidden="true"><span class="pbC-leader-num">3</span></div>
      <div class="pbC-footer-brand">CINEMA <span class="pb-slime-face">SLIME</span></div>
      <nav class="pbC-footer-links">${links}</nav>
      <p class="pbC-footer-copy">
        © ${year} Cinema Slime Productions. All rights reserved.<br />
        <span>Feed updated live from RSS · Powered by slime</span>
      </p>
    </footer>`;
}

/* ========================= D — MARQUEE BOARD ========================= */

function bulbRail() {
  return '<span class="pbD-bulbs" aria-hidden="true"></span>';
}

function buildD(ctx) {
  const { social, year, logo } = ctx;
  const paras = ABOUT_PARAS.map((p) => `<p>${p}</p>`).join('');
  const crew = HOSTS.map((h, i) => `
    <li class="pbD-bill" style="--rot:${[-1.2, 0.8, -0.6][i]}deg">
      <span class="pbD-bill-name">${esc(h.name)}</span>
      <span class="pbD-bill-role">${esc(h.role)}</span>
    </li>`).join('');

  const letters = socialEntries(social).map(([key, s]) => `
    <a class="pbD-letter" href="${esc(s.url)}" target="_blank" rel="noopener" id="subscribe-${esc(key)}">
      <span class="pbD-letter-face">${esc(s.label)}</span>
    </a>`).join('');

  return `
    <section class="pb pb--d" id="about">
      <div class="pbD-board">
        ${bulbRail()}
        <div class="pbD-board-paper"><div class="pbD-board-scrim"></div></div>
        <div class="pbD-halftone"></div>
        <div class="pbD-inner">
          <div class="pbD-copy">
            <p class="pb-stencil">Now showing · The crew</p>
            <h2 class="pbD-title">ABOUT<br />CINEMA SLIME</h2>
            <div class="pbD-prose">${paras}</div>
            <a href="${esc(social.discord.url)}" target="_blank" rel="noopener" class="pbD-cta">Join the Discord</a>
          </div>
          <div class="pbD-cast">
            <p class="pbD-cast-head">BILL OF PLAYERS</p>
            <ul class="pbD-bills">${crew}</ul>
            <a class="pbD-email" href="mailto:${EMAIL}">${EMAIL}</a>
          </div>
        </div>
        ${bulbRail()}
        <img class="pbD-sticker" src="${esc(logo)}" alt="" aria-hidden="true" />
      </div>
    </section>

    <section class="pb pb--d pbD-subscribe" id="subscribe">
      <div class="pbD-marquee">
        ${bulbRail()}
        <p class="pbD-marquee-head">SUBSCRIBE &amp; FOLLOW</p>
        <div class="pbD-letters">${letters}</div>
        ${bulbRail()}
      </div>
    </section>

    ${buildFooterD(ctx, year)}
  `;
}

function buildFooterD({ social }, year) {
  const links = FOOTER_KEYS.map((k) => `
    <a href="${esc(social[k].url)}" target="_blank" rel="noopener">${esc(social[k].label)}</a>`).join('');
  return `
    <footer class="pb-footer pbD-footer">
      <div class="pbD-booth">
        <div class="pbD-footer-brand">CINEMA <span class="pb-slime-face">SLIME</span></div>
        <nav class="pbD-footer-links">${links}</nav>
        <p class="pbD-footer-copy">
          © ${year} Cinema Slime Productions · All rights reserved<br />
          <span>Feed updated live from RSS · Powered by slime</span>
        </p>
      </div>
    </footer>`;
}

/* ========================= entry points ========================= */

const BUILDERS = { A: buildA, B: buildB, C: buildC, D: buildD };

/** The whole bottom of the Discovery View: About + Subscribe + footer.
 *  Returns '' for the control so main.js falls through to the real renderers. */
export function buildProtoBottom(variant, ctx) {
  const build = BUILDERS[variant];
  if (!build) return '';
  return buildProtoDefsHtml() + build(ctx);
}

/** The footer alone, for the Episode and Essay pages. '' on the control. */
export function buildProtoFooter(variant, ctx) {
  const footers = { A: buildFooterA, B: buildFooterB, C: buildFooterC, D: buildFooterD };
  const build = footers[variant];
  if (!build) return '';
  return buildProtoDefsHtml() + build(ctx, ctx.year);
}

/* ========================= the switcher ========================= */

const LABELS = {
  X: 'X · baseline',
  A: 'A · back alley wall',
  B: 'B · photocopied zine',
  C: 'C · end credits',
  D: 'D · marquee board',
};

export function buildProtoSwitcherHtml(active) {
  const btns = VARIANTS.map((v) => `
    <button class="pb-switch-btn${v === active ? ' is-active' : ''}" data-variant="${v}">
      ${LABELS[v]}
    </button>`).join('');
  return `<div class="pb-switch">
    <span class="pb-switch-tag">BOTTOM-OF-SITE PROTOTYPE</span>
    ${btns}
    <button class="pb-switch-btn pb-switch-btn--jump" data-jump="1">↓ jump to bottom</button>
  </div>`;
}

export function bindProtoSwitcher() {
  document.querySelectorAll('.pb-switch-btn[data-variant]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', btn.dataset.variant);
      window.location.href = url.toString();
    });
  });
  document.querySelector('.pb-switch-btn[data-jump]')?.addEventListener('click', () => {
    document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
  });
}
