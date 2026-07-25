// The bottom of the site: About Cinema Slime, Subscribe & Follow, and the
// footer — as the theatre out front.
//
// Shape, and why:
//   - The fold is a back-alley paste-up (ADR 0011). The bottom used to be
//     rounded cards, centered "label / TITLE / red divider" headers and pill
//     buttons — the original site's register, which read as a different
//     website bolted onto the same page. This module replaces all three
//     sections with one continuous marquee treatment: a lit board with chasing
//     bulb rails, the crew as a bill of players, the platforms as letters
//     slotted into a marquee track, and the copyright as a box-office card.
//   - The three sections are ONE object, not three. They share the bulb rail,
//     the warm marquee light (#ffe29e against the site's cold green/red), and
//     the same board edge. That shared frame is what stops the bottom reading
//     as a stack of unrelated widgets.
//   - The centered header stack is gone. Headings sit left, in the display
//     face, with the hard red offset the fold uses.
//   - Grunge is CSS only here — halftone dots and gradients. No image assets
//     (ADR 0011 decision 4). The only SVG filter used is the fold's own
//     #grunge-ink, via .hero-stencil, whose <defs> the Discovery View already
//     renders. The footer therefore uses no filter at all, so it stays correct
//     on the Episode and Essay pages where no hero renders.
//
// Pure functions only — no DOM access, all builders return HTML strings.

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* The hosts, and the address that reaches them. Static content — it changes
   about once a year, and putting it behind a fetch would buy nothing. */
const HOSTS = [
  { name: 'Harrison Jensen', role: 'Host · Producer' },
  { name: 'Renn Jensen', role: 'Host · Producer' },
  { name: 'Scott Sheppard', role: 'Host · Producer' },
];

const EMAIL = 'cinemaslimepodcast@gmail.com';

/* Which platforms the footer repeats. The full set lives in the Subscribe
   marquee above it; the footer carries the five worth a second look. */
export const FOOTER_SOCIAL_KEYS = ['youtube', 'spotify', 'patreon', 'discord', 'instagram'];

/* Each bill is nudged off true by a fixed amount rather than a random one, so
   the crooked row is identical on every render and can't reshuffle mid-session. */
const BILL_ANGLES = ['-1.2deg', '0.8deg', '-0.6deg'];

/** One rail of marquee bulbs. Purely decorative. */
function bulbRail() {
  return '<span class="bulb-rail" aria-hidden="true"></span>';
}

/** About Cinema Slime: the lit board, with the crew billed down the side. */
export function buildAboutSectionHtml({ discordUrl = '', logoUrl = '' } = {}) {
  const bills = HOSTS.map((h, i) => `
        <li class="bill" style="--bill-rot:${BILL_ANGLES[i % BILL_ANGLES.length]}">
          <span class="bill-name">${escapeHtml(h.name)}</span>
          <span class="bill-role">${escapeHtml(h.role)}</span>
        </li>`).join('');

  return `
    <section class="section-board" id="about">
      <div class="board">
        ${bulbRail()}
        <div class="board-face"></div>
        <div class="board-halftone"></div>

        <div class="board-inner">
          <div class="board-copy">
            <p class="hero-stencil">Now showing · The crew</p>
            <h2 class="board-title">ABOUT<br />CINEMA SLIME</h2>
            <div class="board-prose">
              <p>
                <span class="red">Cinema Slime</span> is the podcast where film obsession gets
                <span class="highlight">gloriously messy</span>. Every month, hosts Harrison, Renn &amp;
                Scott randomly draw from personalized category lists and dive headfirst into the movies
                that shaped us.
              </p>
              <p>
                From 1930s noir to 90s nostalgia bombs, from animation deep dives to space horror —
                no genre is safe from the <span class="highlight">slime treatment</span>.
                Each episode features unfiltered discussion, the legendary
                <span class="red">Slimiest Scenes</span> segment, star ratings, and a live
                category lottery for the next month.
              </p>
              <p>
                Whether you're here for the hot takes, the deep cuts, or just want to hear three
                friends argue about whether Vanilla Ice saved TMNT 2 — you're home.
              </p>
            </div>
            <a href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener" class="board-cta">
              Join the Discord
            </a>
          </div>

          <div class="board-cast">
            <p class="board-cast-head">Bill of players</p>
            <ul class="bills">${bills}</ul>
            <a class="board-email" href="mailto:${EMAIL}">${EMAIL}</a>
          </div>
        </div>

        ${bulbRail()}
        <img class="board-sticker" src="${escapeHtml(logoUrl)}" alt="" aria-hidden="true" />
      </div>
    </section>
  `;
}

/** Subscribe & Follow: every platform, as a letter slotted into the marquee. */
export function buildSubscribeSectionHtml(social = {}) {
  const letters = Object.entries(social).map(([key, s]) => `
        <a class="marquee-letter" href="${escapeHtml(s.url)}" target="_blank" rel="noopener" id="subscribe-${escapeHtml(key)}">
          <span class="marquee-letter-face">${escapeHtml(s.label)}</span>
        </a>`).join('');

  return `
    <section class="section-board section-board--marquee" id="subscribe">
      <div class="marquee">
        ${bulbRail()}
        <p class="marquee-head">Subscribe &amp; Follow</p>
        <div class="marquee-letters">${letters}</div>
        ${bulbRail()}
      </div>
    </section>
  `;
}

/** The box office: wordmark, the short link set, and the copyright card. */
export function buildFooterHtml({ social = {}, year = new Date().getFullYear() } = {}) {
  const links = FOOTER_SOCIAL_KEYS
    .filter((k) => social[k])
    .map((k) => `
        <a href="${escapeHtml(social[k].url)}" target="_blank" rel="noopener">${escapeHtml(social[k].label)}</a>`)
    .join('');

  return `
    <footer class="footer">
      <div class="booth">
        <div class="footer-brand">CINEMA <span class="slime">SLIME</span></div>
        <nav class="footer-links">${links}</nav>
        <p class="footer-copy">
          © ${year} Cinema Slime Productions · All rights reserved<br />
          <span>Feed updated live from RSS · Powered by slime</span>
        </p>
      </div>
    </footer>
  `;
}
