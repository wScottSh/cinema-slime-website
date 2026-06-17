import './style.css';
import { getEpisodeByIdentifier } from './episode-data.js';
import { parseHash, navigateToEpisode, navigateHome, buildEpisodeHash, normalizeBootUrl } from './router.js';
import { normalizeDescription } from './description-normalizer.js';
import { parseCoordinate } from './essay-coordinate.js';
import { fetchEssayByCoordinate, fetchCurationList, fetchEssaysForDiscovery, fetchSocialProof, createSharedPool } from './nostr-pool.js';
import { selectCuratedEssay } from './essay-curation.js';
import { buildEssaysSectionHtml } from './essay-card.js';
import { buildEpisodeCardHtml } from './episode-card.js';
import { buildEssaySpotlightHtml } from './essay-spotlight.js';
import { normalizeEssayContent } from './essay-content-normalizer.js';
import { buildEssayHeaderHtml } from './essay-header.js';
import { buildNostrClientUrl } from './nostr-links.js';
import { buildHeroBgTileDescriptors, buildHeroBgTileHtml } from './hero-bg-tiles.js';
import { revealHeroBgTiles } from './hero-bg-reveal.js';
import { parseEpisodes } from './rss-parse.js';
import { parseEssaysSnapshot } from './essays-snapshot.js';
import { createSWRCache } from './swr-cache.js';
import { shouldApplyFreshData, decideEssayPageRevalidation } from './revalidation-policy.js';

const EPISODES_CACHE_KEY = 'cs:episodes';
const ESSAYS_CACHE_KEY = 'cs:essays';
// __BUILD_VERSION__ is replaced at build time by Vite (see vite.config.js).
// Bump package.json version when the cached Episode data shape changes.
const BUILD_VERSION = __BUILD_VERSION__;
// Bump ESSAYS_SHAPE_VERSION when the essays cache data shape changes.
// Intentionally independent of BUILD_VERSION so code deploys don't evict
// a returning reader's cached Essays.
const ESSAYS_SHAPE_VERSION = '1';

// Same-origin path served by the nginx reverse-proxy/cache (see
// docs/deploy/nginx-rss-proxy.md). nginx proxy_passes to the Anchor feed,
// caches it, and serves the last-good copy when upstream is down.
const RSS_FEED_PATH = '/api/rss';
// Same-origin edge-cached Essay snapshot paths (ADR 0008). nginx proxies these
// to api.nostr.band and serves the last-good copy when the upstream is down.
const ESSAYS_CURATION_PATH = '/api/essays/curation';
const ESSAYS_EVENTS_PATH = '/api/essays/events';
const SHOW_ART = 'https://d3t3ozftmdmh3i.cloudfront.net/staging/podcast_uploaded_nologo/43698817/43698817-1757516582372-2a574ca9eaf8e.jpg';
const LOGO = '/cs-logo.png';

const SOCIAL = {
  youtube: { url: 'https://youtube.com/@cinemaslime', label: 'YouTube' },
  spotify: { url: 'https://podcasters.spotify.com/pod/show/cinema-slime-podcast', label: 'Spotify' },
  patreon: { url: 'https://patreon.com/CinemaSlime', label: 'Patreon' },
  discord: { url: 'https://discord.gg/U4vZg9xgWw', label: 'Discord' },
  instagram: { url: 'https://www.instagram.com/cinemaslimepodcast', label: 'Instagram' },
  facebook: { url: 'https://www.facebook.com/cinemaslime', label: 'Facebook' },
  tiktok: { url: 'https://www.tiktok.com/@cinemaslimex', label: 'TikTok' },
  coffee: { url: 'http://coff.ee/cinemaslimepodcast', label: 'Buy Us Coffee' },
};

// Single long-lived relay pool created at init and shared across all Essay
// fetchers. Pre-warmed at startup so WebSocket connections are open before the
// reader navigates to an Essay (see issue #82 / ADR 0007).
let sharedPool = null;

let episodes; // undefined while loading; [] on error/empty; Array when loaded
let filteredEpisodes; // mirrors episodes loading state
let pendingEpisodes = null; // fresh data held while user is interacting
let pendingEssays = null; // fresh essay data held while user is scrolled into essays
let currentFilter = 'all';
let searchQuery = '';
let audioPlayer = null;
let currentEpisode = null;
let savedScrollY = 0;
// undefined = still loading, null = relay failure, [] = empty, Array = loaded
let officialEssays;

const ORIGINAL_TITLE = document.title;

// ===== SNAPSHOT FETCH =====
// Fetch both /api/essays/* endpoints in parallel, parse the snapshot, and
// return the same { coordinate, essay, slug }[] shape fetchEssaysForDiscovery
// produces. Returns null on any fetch or parse failure so the caller can fall
// through to the existing relay + localStorage path without regression.
async function fetchEssaysSnapshot() {
  try {
    const [curationRes, eventsRes] = await Promise.all([
      fetch(ESSAYS_CURATION_PATH),
      fetch(ESSAYS_EVENTS_PATH),
    ]);
    if (!curationRes.ok || !eventsRes.ok) return null;
    const [curationJson, eventsJson] = await Promise.all([
      curationRes.json(),
      eventsRes.json(),
    ]);
    return parseEssaysSnapshot(curationJson, eventsJson);
  } catch (err) {
    console.warn('[essays] snapshot fetch failed:', err);
    return null;
  }
}

// ===== RSS FETCH =====
async function fetchRSS() {
  try {
    const res = await fetch(RSS_FEED_PATH);
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const text = await res.text();
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    return parseEpisodes(xml, SHOW_ART);
  } catch (err) {
    console.error('RSS fetch error:', err);
    return [];
  }
}

// Reseed the episode list and reset the filtered view to the full list,
// clearing any active search/filter (see applyFilters for the filtered path).
function setEpisodes(list) {
  episodes = list;
  filteredEpisodes = [...list];
}

function isScrolledInto(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return false;
  return section.getBoundingClientRect().top < window.innerHeight;
}

// Apply fresh data held back during an interaction (see the revalidate path in init).
function flushPendingEpisodes() {
  if (!pendingEpisodes) return;
  setEpisodes(pendingEpisodes);
  pendingEpisodes = null;
}

function flushPendingEssays() {
  if (!pendingEssays) return;
  officialEssays = pendingEssays;
  pendingEssays = null;
  refreshEssaysGrid();
}

// ===== HELPERS =====
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function cleanTitle(title) {
  return title.replace(/\s*\|\s*Cinema Slime Podcast.*$/i, '')
              .replace(/\s*x\s*Cinema Slime Podcast.*$/i, '')
              .replace(/\s*Review & Deep Dive.*$/i, '');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getEpLabel(ep) {
  if (ep.episodeType === 'bonus') return 'BONUS';
  if (ep.episodeType === 'trailer') return 'TRAILER';
  return ep.episode ? `EPISODE ${ep.episode}` : '';
}

function setEpisodePageTitle(ep) {
  document.title = `${cleanTitle(ep.title)} | Cinema Slime Podcast`;
}

function restoreDocumentTitle() {
  document.title = ORIGINAL_TITLE;
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function getShortDescription(desc) {
  let text = stripHtml(desc);
  // Remove boilerplate
  text = text.replace(/EXPERIENCE MOVIES WITH US![\s\S]*/i, '').trim();
  text = text.replace(/Subscribe to the[\s\S]*/i, '').trim();
  text = text.replace(/📱[\s\S]*/i, '').trim();
  // Remove timestamps at the start
  text = text.replace(/^\(\d+:\d+\)[\s\S]*?\n/gm, '').trim();
  // Clean up
  text = text.replace(/^[\s*•\-]+/, '').trim();
  if (text.length > 300) text = text.substring(0, 300) + '…';
  return text;
}

// ===== ICONS =====
const icons = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
};

// ===== RENDER =====
function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="grain-overlay"></div>
    ${renderNav()}
    ${renderHero()}
    ${renderEpisodesSection()}
    ${renderEssaysSection()}
    ${renderAbout()}
    ${renderSubscribe()}
    ${renderFooter()}
    ${renderStickyPlayer()}
  `;
  bindEvents();
  observeAnimations();
  revealHeroBgTiles();
}

function renderNav() {
  return `
    <nav class="nav" id="main-nav">
      <a class="nav-brand" href="#" id="nav-home">
        <img src="${LOGO}" alt="Cinema Slime" loading="lazy" />
        <span class="nav-brand-text">CINEMA <span class="slime">SLIME</span></span>
      </a>
      <div class="nav-links" id="nav-links">
        <a href="#episodes" class="active" data-section="episodes">Episodes</a>
        <a href="#essays" data-section="essays">Essays</a>
        <a href="#about" data-section="about">About</a>
        <a href="#subscribe" data-section="subscribe">Subscribe</a>
        <a href="${SOCIAL.patreon.url}" target="_blank" rel="noopener">Patreon</a>
      </div>
      <button class="mobile-menu-btn" id="mobile-menu" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </nav>
  `;
}

function renderHeroDynamic() {
  if (episodes === undefined) {
    return `
      <div class="hero-latest hero-latest--skeleton">
        <div class="hero-latest-art">
          <div class="skeleton-block"></div>
          <span class="hero-latest-badge">LATEST EPISODE</span>
        </div>
        <div class="hero-latest-info">
          <div class="skeleton-line skeleton-line--sm"></div>
          <div class="skeleton-line skeleton-line--lg"></div>
          <div class="skeleton-line skeleton-line--md"></div>
          <div class="skeleton-line skeleton-line--sm" style="margin-bottom:1.5rem;"></div>
          <div class="skeleton-line" style="width:55%;height:2.8rem;border-radius:50px;margin-bottom:0;"></div>
        </div>
      </div>
      <p class="hero-ep-count">LOADING EPISODES&hellip;</p>
      <div id="hero-essay-spotlight">${buildEssaySpotlightHtml(officialEssays)}</div>
    `;
  }

  const epCount = episodes.length;
  const latest = episodes.find(e => e.episodeType === 'full') || episodes[0];
  const latestIdx = latest ? episodes.indexOf(latest) : 0;
  const label = latest ? getEpLabel(latest) : '';
  const desc = latest ? getShortDescription(latest.description) : '';

  return `
    ${latest ? `
    <div class="hero-latest" id="hero-latest" data-idx="${latestIdx}">
      <div class="hero-latest-art">
        <img src="${latest.image}" alt="${cleanTitle(latest.title)}" />
        <div class="hero-latest-play-overlay">${icons.play}</div>
        <span class="hero-latest-badge">LATEST EPISODE</span>
      </div>
      <div class="hero-latest-info">
        <span class="hero-latest-ep">${label}</span>
        <h2 class="hero-latest-title">${cleanTitle(latest.title)}</h2>
        <span class="hero-latest-date">${formatDate(latest.pubDate)} · ${latest.duration || ''}</span>
        <p class="hero-latest-desc">${desc}</p>
        <div class="hero-cta-group">
          <button class="btn btn-primary" onclick="window.__playEp(${latestIdx})">▶ Play Now</button>
          <a href="${SOCIAL.youtube.url}" target="_blank" rel="noopener" class="btn btn-secondary">YouTube</a>
          <a href="${SOCIAL.spotify.url}" target="_blank" rel="noopener" class="btn btn-ghost">Spotify</a>
        </div>
      </div>
    </div>
    ` : ''}
    <p class="hero-ep-count">${epCount} EPISODES AND COUNTING</p>
    <div id="hero-essay-spotlight">${buildEssaySpotlightHtml(officialEssays)}</div>
  `;
}

function renderHero() {
  // Shuffle episodes for varied tile images; gracefully handles loading state (undefined → [])
  const shuffledEps = (episodes && episodes.length)
    ? [...episodes].sort(() => Math.random() - 0.5)
    : [];
  const tileDescriptors = buildHeroBgTileDescriptors(
    shuffledEps,
    { width: window.innerWidth, height: window.innerHeight },
    SHOW_ART
  );

  const tilesHtml = tileDescriptors.map(buildHeroBgTileHtml).join('');

  return `
    <section class="hero" id="hero">
      <div class="hero-bg-tiles" aria-hidden="true">${tilesHtml}</div>
      <div class="hero-bg-fade"></div>

      <div class="hero-content">
        <div class="hero-branding">
          <img class="hero-logo" src="${LOGO}" alt="Cinema Slime Podcast Logo" />
          <h1 class="hero-title">
            <span class="cinema">CINEMA</span>
            <span class="slime-text">SLIME</span>
          </h1>
          <p class="hero-tagline">
            Every month we randomly pick 4 films to watch and discuss.
            Deep dives, hot takes, and slimey ratings.
          </p>
          <p class="hero-hosts">Harrison Jensen · Renn Jensen · Scott Sheppard</p>
        </div>

        <div id="hero-dynamic">
          ${renderHeroDynamic()}
        </div>
      </div>
    </section>
  `;
}

function renderEpisodesSection() {
  return `
    <section class="section" id="episodes">
      <div class="section-header animate-in">
        <p class="section-label">The Vault</p>
        <h2 class="section-title">ALL EPISODES</h2>
        <div class="section-divider"></div>
      </div>
      <div class="search-bar animate-in">
        ${icons.search}
        <input type="text" id="episode-search" placeholder="Search episodes..." value="${escapeHtml(searchQuery)}" />
      </div>
      <div class="filter-bar animate-in" id="filter-bar">
        <button class="filter-btn${currentFilter === 'all' ? ' active' : ''}" data-filter="all">All</button>
        <button class="filter-btn${currentFilter === 'full' ? ' active' : ''}" data-filter="full">Full Episodes</button>
        <button class="filter-btn${currentFilter === 'bonus' ? ' active' : ''}" data-filter="bonus">Bonus</button>
        <button class="filter-btn${currentFilter === 'trailer' ? ' active' : ''}" data-filter="trailer">Trailers</button>
      </div>
      <div class="episodes-grid" id="episodes-grid">
        ${renderEpisodeCards()}
      </div>
    </section>
  `;
}

function renderEpisodeSkeletons(n) {
  return Array.from({ length: n }, () => `
    <article class="episode-card episode-card--skeleton animate-in visible">
      <div class="episode-card-art">
        <div class="skeleton-block"></div>
      </div>
      <div class="episode-card-body">
        <div class="skeleton-line skeleton-line--sm"></div>
        <div class="skeleton-line skeleton-line--lg"></div>
        <div class="skeleton-line skeleton-line--md"></div>
      </div>
    </article>
  `).join('');
}

function renderEpisodeCards() {
  if (filteredEpisodes === undefined) {
    return renderEpisodeSkeletons(8);
  }
  if (!filteredEpisodes.length) {
    return '<p style="text-align:center;color:var(--text-muted);grid-column:1/-1;padding:3rem;">No episodes found.</p>';
  }
  return filteredEpisodes.map((ep) => {
    const realIdx = episodes.indexOf(ep);
    return buildEpisodeCardHtml(ep, realIdx);
  }).join('');
}

function renderEssaysSection() {
  let inner;
  if (officialEssays === undefined) {
    inner = '<div class="loader" style="padding:3rem;grid-column:1/-1;"><div class="loader-spinner"></div><p class="loader-text">Loading essays...</p></div>';
  } else {
    inner = buildEssaysSectionHtml(officialEssays);
  }
  return `
    <section class="section" id="essays">
      <div class="section-header animate-in">
        <p class="section-label">Cinema Slime Writing</p>
        <h2 class="section-title">ESSAYS</h2>
        <div class="section-divider"></div>
      </div>
      <div class="essays-grid" id="essays-grid">
        ${inner}
      </div>
    </section>
  `;
}

function renderAbout() {
  return `
    <section class="section" id="about">
      <div class="section-header animate-in">
        <p class="section-label">The Crew</p>
        <h2 class="section-title">ABOUT CINEMA SLIME</h2>
        <div class="section-divider"></div>
      </div>
      <div class="about-grid">
        <div class="about-text animate-in">
          <p>
            <span class="red">Cinema Slime</span> is the podcast where film obsession gets
            <span class="highlight">gloriously messy</span>. Every month, hosts Harrison, Renn &
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
          <div style="margin-top:1.5rem;">
            <a href="${SOCIAL.discord.url}" target="_blank" rel="noopener" class="btn btn-ghost">
              Join the Discord
            </a>
          </div>
        </div>
        <div class="host-cards animate-in">
          <div class="host-card">
            <h3>HARRISON JENSEN</h3>
            <span class="host-role">Host · Producer</span>
          </div>
          <div class="host-card">
            <h3>RENN JENSEN</h3>
            <span class="host-role">Host · Producer</span>
          </div>
          <div class="host-card">
            <h3>SCOTT SHEPPARD</h3>
            <span class="host-role">Host · Producer</span>
          </div>
          <div style="text-align:center;margin-top:1rem;">
            <a href="mailto:cinemaslimepodcast@gmail.com" style="color:var(--text-muted);font-size:0.8rem;text-decoration:none;">
              cinemaslimepodcast@gmail.com
            </a>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSubscribe() {
  return `
    <section class="section subscribe-section" id="subscribe">
      <div class="section-header animate-in">
        <p class="section-label">Tune In</p>
        <h2 class="section-title">SUBSCRIBE & FOLLOW</h2>
        <div class="section-divider"></div>
      </div>
      <div class="subscribe-grid animate-in">
        ${Object.entries(SOCIAL).map(([key, s]) => `
          <a href="${s.url}" target="_blank" rel="noopener" class="subscribe-link" id="subscribe-${key}">
            ${s.label}
          </a>
        `).join('')}
      </div>
    </section>
  `;
}

function renderFooter() {
  return `
    <footer class="footer">
      <div class="footer-brand">CINEMA <span class="slime">SLIME</span></div>
      <div class="footer-links">
        <a href="${SOCIAL.youtube.url}" target="_blank">YouTube</a>
        <a href="${SOCIAL.spotify.url}" target="_blank">Spotify</a>
        <a href="${SOCIAL.patreon.url}" target="_blank">Patreon</a>
        <a href="${SOCIAL.discord.url}" target="_blank">Discord</a>
        <a href="${SOCIAL.instagram.url}" target="_blank">Instagram</a>
      </div>
      <p class="footer-copy">
        © ${new Date().getFullYear()} Cinema Slime Productions. All rights reserved.<br />
        <span style="font-size:0.65rem;color:var(--text-muted);">
          Feed updated live from RSS · Powered by slime
        </span>
      </p>
    </footer>
  `;
}

function renderStickyPlayer() {
  return `
    <div class="sticky-player" id="sticky-player">
      <img class="sticky-player-art" id="player-art" src="${SHOW_ART}" alt="" />
      <div class="sticky-player-info">
        <h4 id="player-title">-</h4>
        <span id="player-ep-label">-</span>
      </div>
      <div class="sticky-player-controls">
        <button class="player-btn" id="player-prev" aria-label="Previous">${icons.prev}</button>
        <button class="player-btn play-pause" id="player-play" aria-label="Play/Pause">${icons.play}</button>
        <button class="player-btn" id="player-next" aria-label="Next">${icons.next}</button>
      </div>
      <div class="player-progress">
        <span class="time" id="player-current">0:00</span>
        <input type="range" id="player-seek" min="0" max="100" value="0" />
        <span class="time" id="player-duration">0:00</span>
      </div>
      <button class="player-close" id="player-close" aria-label="Close">${icons.close}</button>
    </div>
  `;
}

// ===== AUDIO PLAYER =====
function playEpisode(idx) {
  const ep = episodes[idx];
  if (!ep || !ep.audioUrl) return;
  currentEpisode = idx;

  if (!audioPlayer) {
    audioPlayer = new Audio();
    audioPlayer.addEventListener('timeupdate', updatePlayerProgress);
    audioPlayer.addEventListener('loadedmetadata', () => {
      document.getElementById('player-duration').textContent = formatTime(audioPlayer.duration);
    });
    audioPlayer.addEventListener('ended', () => {
      const nextIdx = currentEpisode - 1;
      if (nextIdx >= 0) playEpisode(nextIdx);
      else togglePlayPause();
    });
  }

  audioPlayer.src = ep.audioUrl;
  audioPlayer.play();
  document.body.classList.add('player-active');

  const player = document.getElementById('sticky-player');
  player.classList.add('active');
  document.getElementById('player-art').src = ep.image;
  document.getElementById('player-title').textContent = cleanTitle(ep.title);
  document.getElementById('player-ep-label').textContent = getEpLabel(ep) + ' · ' + formatDate(ep.pubDate);
  updatePlayButton(true);
}
window.__playEp = playEpisode;

function togglePlayPause() {
  if (!audioPlayer) return;
  if (audioPlayer.paused) {
    audioPlayer.play();
    updatePlayButton(true);
  } else {
    audioPlayer.pause();
    updatePlayButton(false);
  }
}

function updatePlayButton(playing) {
  const btn = document.getElementById('player-play');
  if (btn) btn.innerHTML = playing ? icons.pause : icons.play;
}

function updatePlayerProgress() {
  if (!audioPlayer) return;
  const cur = audioPlayer.currentTime;
  const dur = audioPlayer.duration || 1;
  document.getElementById('player-current').textContent = formatTime(cur);
  const seekBar = document.getElementById('player-seek');
  seekBar.value = (cur / dur) * 100;
  // Update range background
  seekBar.style.background = `linear-gradient(to right, var(--slime-green) ${(cur/dur)*100}%, var(--border-subtle) ${(cur/dur)*100}%)`;
}

function bindPlayerEvents() {
  document.getElementById('player-play')?.addEventListener('click', togglePlayPause);
  document.getElementById('player-prev')?.addEventListener('click', () => {
    if (currentEpisode !== null && currentEpisode < episodes.length - 1) playEpisode(currentEpisode + 1);
  });
  document.getElementById('player-next')?.addEventListener('click', () => {
    if (currentEpisode !== null && currentEpisode > 0) playEpisode(currentEpisode - 1);
  });
  document.getElementById('player-seek')?.addEventListener('input', (e) => {
    if (!audioPlayer) return;
    audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
  });
  document.getElementById('player-close')?.addEventListener('click', () => {
    if (audioPlayer) { audioPlayer.pause(); audioPlayer.src = ''; }
    const p = document.getElementById('sticky-player');
    if (p) p.classList.remove('active');
    document.body.classList.remove('player-active');
  });
}

function restorePlayerUI() {
  if (!audioPlayer || currentEpisode === null) return;
  const ep = episodes[currentEpisode];
  if (!ep) return;
  const player = document.getElementById('sticky-player');
  if (!player) return;
  player.classList.add('active');
  document.body.classList.add('player-active');
  const art = document.getElementById('player-art');
  const title = document.getElementById('player-title');
  const label = document.getElementById('player-ep-label');
  if (art) art.src = ep.image;
  if (title) title.textContent = cleanTitle(ep.title);
  if (label) label.textContent = getEpLabel(ep) + ' · ' + formatDate(ep.pubDate);
  updatePlayButton(!audioPlayer.paused);
  updatePlayerProgress();
}

// ===== EVENTS =====
function bindEpisodeCardEvents(container) {
  container.querySelectorAll('.episode-card:not(.episode-card--skeleton)').forEach(card => {
    const idx = parseInt(card.dataset.idx);
    const playEl = card.querySelector('.episode-card-play');
    if (playEl) {
      // stopPropagation prevents the click from bubbling to the <a> wrapper.
      // preventDefault guards against the button submitting a form if one ever
      // wraps this area (defensive; there is no form today).
      playEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        playEpisode(idx);
      });
    }
    // Navigation is handled by the <a> wrapper rendered by buildEpisodeCardHtml.
    // We intercept the click at the link level so we can save the scroll position
    // before navigating (used by the back-navigation scroll restore).
    const linkEl = card.closest('.episode-card-link');
    if (linkEl) {
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        const ep = episodes[idx];
        if (ep && ep.guid) goToEpisodePage(ep.guid);
      });
    }
  });
}

function bindHeroLatest() {
  document.getElementById('hero-latest')?.addEventListener('click', (e) => {
    const hero = document.getElementById('hero-latest');
    const idx = parseInt(hero?.dataset.idx);
    const ep = (idx != null && !isNaN(idx)) ? episodes[idx] : null;
    if (e.target.closest('.btn') || e.target.closest('.hero-latest-play-overlay')) {
      if (ep) playEpisode(idx);
    } else if (ep && ep.guid) {
      goToEpisodePage(ep.guid);
    }
  });
}

function bindEvents() {
  // Nav scroll
  const nav = document.getElementById('main-nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 50);
  });

  // Mobile menu
  const menuBtn = document.getElementById('mobile-menu');
  const navLinks = document.getElementById('nav-links');
  menuBtn?.addEventListener('click', () => navLinks.classList.toggle('open'));
  navLinks?.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
  });

  // Home
  document.getElementById('nav-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  bindEpisodeCardEvents(document);
  bindHeroLatest();

  bindPlayerEvents();

  // Search
  document.getElementById('episode-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilters();
  });

  // Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilters();
    });
  });
  restorePlayerUI();
}

// Re-render the episodes grid from the current filteredEpisodes state and
// rebind its events. No-op when the grid isn't in the DOM (e.g. on a sub-page).
function refreshEpisodesGrid() {
  const grid = document.getElementById('episodes-grid');
  if (!grid) return;
  grid.innerHTML = renderEpisodeCards();
  bindEpisodeCardEvents(grid);
  observeAnimations();
}

// Re-render the essays grid from the current officialEssays state.
// No-op when the grid isn't in the DOM (e.g. on a sub-page).
function refreshEssaysGrid() {
  const grid = document.getElementById('essays-grid');
  if (!grid) return;
  grid.innerHTML = buildEssaysSectionHtml(officialEssays);
  observeAnimations();
  refreshEssaySpotlight();
}

// Patch the hero essay spotlight slot in step with the essays grid.
// No-op when the slot isn't in the DOM (e.g. on a sub-page).
function refreshEssaySpotlight() {
  const slot = document.getElementById('hero-essay-spotlight');
  if (!slot) return;
  slot.innerHTML = buildEssaySpotlightHtml(officialEssays);
}

function applyFilters() {
  if (!episodes) return;
  // Flush held fresh data once the search has been cleared (user is no longer interacting).
  if (!searchQuery) flushPendingEpisodes();
  filteredEpisodes = episodes.filter(ep => {
    const matchType = currentFilter === 'all' || ep.episodeType === currentFilter;
    const matchSearch = !searchQuery ||
      ep.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchSearch;
  });
  refreshEpisodesGrid();
}

// ===== SCROLL ANIMATIONS =====
function observeAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.animate-in:not(.visible)').forEach(el => observer.observe(el));
}

function renderEpisodePage(ep) {
  const app = document.getElementById('app');
  const { cleanedHtml, rawHtml } = normalizeDescription(ep.description || '');
  const label = getEpLabel(ep);
  const safeRaw = escapeHtml(rawHtml);
  app.innerHTML = `
    <div class="grain-overlay"></div>
    ${renderNav()}
    <div class="episode-page">
      <a href="#" id="back-to-episodes" class="back-link">← Back to all episodes</a>
        <div class="episode-header">
          <img src="${ep.image}" alt="${cleanTitle(ep.title)}" class="episode-art" />
          <div class="episode-meta">
            ${label ? `<span class="episode-label">${label}</span>` : ''}
            <h1 class="episode-title">${cleanTitle(ep.title)}</h1>
            <p class="episode-date">${formatDate(ep.pubDate)}${ep.duration ? ' · ' + ep.duration : ''}</p>
            <button id="episode-play-btn" class="btn btn-primary episode-play-btn">${icons.play} Play Episode</button>
          </div>
        </div>
      <div class="episode-content">
        <div class="episode-description">
          ${cleanedHtml || '<p style="color:var(--text-muted);font-style:italic;">No description available for this episode.</p>'}
        </div>
        <details class="original-disclosure">
          <summary>View original RSS description</summary>
          <div class="raw-description">${safeRaw}</div>
        </details>
      </div>
    </div>
    ${renderFooter()}
    ${renderStickyPlayer()}
  `;
  const back = document.getElementById('back-to-episodes');
  if (back) back.addEventListener('click', (e) => { e.preventDefault(); navigateHome(); });
  const navHome = document.getElementById('nav-home');
  if (navHome) navHome.addEventListener('click', (e) => { e.preventDefault(); navigateHome(); });
  const playBtn = document.getElementById('episode-play-btn');
  if (playBtn) { playBtn.addEventListener('click', () => { const idx = episodes.indexOf(ep); if (idx !== -1) playEpisode(idx); }); }
  bindPlayerEvents();
  restorePlayerUI();
}

function goToEpisodePage(guid) {
  if (guid) {
    savedScrollY = window.scrollY;
    navigateToEpisode(guid);
  }
}

// ===== ESSAY PAGES (Nostr) =====
const ZERO_SOCIAL_PROOF = { totalSats: 0, largestZap: 0, heartCount: 0 };

function setEssayPageTitle(essay) {
  document.title = `${essay.title || 'Essay'} | Cinema Slime`;
}

// True when the Essay route for the given coordinate or slug is still the one
// in the address bar. Guards against committing a view the user navigated away
// from while a relay fetch was in flight.
function isEssayRouteActive({ coordinate, slug }) {
  const route = parseHash(window.location.hash);
  if (route.type !== 'essay') return false;
  return coordinate ? route.coordinate === coordinate : route.slug === slug;
}


function bindEssayShell() {
  const back = document.getElementById('back-from-essay');
  if (back) back.addEventListener('click', (e) => { e.preventDefault(); navigateHome(); });
  const navHome = document.getElementById('nav-home');
  if (navHome) navHome.addEventListener('click', (e) => { e.preventDefault(); navigateHome(); });
  bindPlayerEvents();
  restorePlayerUI();
}

function renderEssayLoading() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="grain-overlay"></div>
    ${renderNav()}
    <div class="episode-page essay-page">
      <div class="loader" style="min-height:50vh;">
        <div class="loader-spinner"></div>
        <p class="loader-text">Fetching essay from Nostr...</p>
      </div>
    </div>
    ${renderFooter()}
    ${renderStickyPlayer()}
  `;
  bindEssayShell();
}

function renderSocialProofHtml({ totalSats, largestZap, heartCount }) {
  const hasZaps = totalSats > 0;
  const hasHearts = heartCount > 0;
  if (!hasZaps && !hasHearts) return '';
  const isWhaleZap = hasZaps && largestZap > totalSats / 2;
  const zapHtml = hasZaps
    ? `<span class="social-proof-zaps${isWhaleZap ? ' social-proof-zaps--whale' : ''}" title="${isWhaleZap ? `One zap of ${largestZap.toLocaleString()} sats dominates` : `${totalSats.toLocaleString()} sats total`}">⚡ ${totalSats.toLocaleString()} sats</span>`
    : '';
  const heartsHtml = hasHearts
    ? `<span class="social-proof-hearts" title="${heartCount.toLocaleString()} heart${heartCount !== 1 ? 's' : ''}">♥ ${heartCount.toLocaleString()}</span>`
    : '';
  return `<div class="social-proof">${zapHtml}${heartsHtml}</div>`;
}

function renderEssayPage(essay, socialProof = ZERO_SOCIAL_PROOF) {
  const app = document.getElementById('app');
  const { bodyHtml, rawMarkdown } = normalizeEssayContent(essay.body);
  const nostrClientUrl = buildNostrClientUrl(essay.coordinateString);
  const rawEventJson = JSON.stringify({
    id: essay.eventId,
    pubkey: essay.pubkey,
    created_at: essay.createdAt,
    kind: essay.coordinate?.kind,
    coordinate: essay.coordinateString,
    title: essay.title,
    published_at: essay.publishedAt,
  }, null, 2);
  app.innerHTML = `
    <div class="grain-overlay"></div>
    ${renderNav()}
    <div class="episode-page essay-page">
      <a href="#" id="back-from-essay" class="back-link">← Back to Cinema Slime</a>
      ${buildEssayHeaderHtml(essay)}
      ${renderSocialProofHtml(socialProof)}
      <div class="episode-content">
        <div class="episode-description essay-body">
          ${bodyHtml || '<p style="color:var(--text-muted);font-style:italic;">This Essay has no content yet.</p>'}
        </div>
        <details class="original-disclosure">
          <summary>View original Nostr event</summary>
          <div class="raw-description">
            ${nostrClientUrl ? `<a href="${escapeHtml(nostrClientUrl)}" target="_blank" rel="noopener" class="nostr-client-link">Open in Nostr client ↗</a>` : ''}
            <pre class="nostr-event-json">${escapeHtml(rawEventJson)}</pre>
            ${rawMarkdown ? `<details class="raw-markdown-disclosure"><summary>Raw markdown source</summary><pre class="nostr-event-json">${escapeHtml(rawMarkdown)}</pre></details>` : ''}
          </div>
        </details>
      </div>
    </div>
    ${renderFooter()}
    ${renderStickyPlayer()}
  `;
  bindEssayShell();
}

function renderEssayNotFound(coordinateString) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="grain-overlay"></div>
    ${renderNav()}
    <div class="episode-page essay-page" style="text-align:center;padding-top:4rem;">
      <a href="#" id="back-from-essay" class="back-link" style="margin-bottom:2rem;display:inline-block;">← Back to Cinema Slime</a>
      <h2 style="font-family:var(--font-display);letter-spacing:1px;">Essay unavailable</h2>
      <p style="color:var(--text-muted);">We couldn't load this Essay right now — it may not exist, or the Nostr relays may be unreachable. Please try again later.<br><code style="font-size:0.8em;background:var(--bg-card);padding:2px 6px;border-radius:3px;word-break:break-all;">${escapeHtml(coordinateString)}</code></p>
    </div>
    ${renderFooter()}
    ${renderStickyPlayer()}
  `;
  bindEssayShell();
  document.title = 'Essay unavailable | Cinema Slime';
}

// Look up an Essay in the Discovery entries (in-memory, seeded from the SWR
// localStorage cache on init). Those entries carry the full essay body and the
// brand-approved author name, so an Essay Page can paint without touching a
// relay. Returns the official essay object, or null when not cached.
function getCachedOfficialEssay({ coordinate, slug }) {
  if (!Array.isArray(officialEssays)) return null;
  const entry = coordinate
    ? officialEssays.find((e) => e && e.coordinate === coordinate)
    : officialEssays.find((e) => e && e.slug === slug);
  return entry?.essay ?? null;
}

// Commit fresh relay data to an Essay Page that may already show a cached
// copy. The decision itself is pure (see decideEssayPageRevalidation); this
// applies it: the DOM is touched only on a real change, and an update under a
// reader restores their scroll position (ADR 0006 #5).
function applyEssayPageRevalidation({ cached, official, essay, curation, socialProof, notFoundKey }) {
  const decision = decideEssayPageRevalidation({
    cachedEventId: cached?.eventId ?? null,
    freshEventId: official?.eventId ?? null,
    isOfficial: Boolean(official),
    essayFetched: Boolean(essay),
    curationSize: curation?.coordinates?.size ?? 0,
    // The cached paint always uses zero social proof, so any non-zero count is new.
    socialProofChanged: socialProof.totalSats > 0 || socialProof.heartCount > 0,
  });
  if (decision === 'keep-current') return;
  if (decision === 'not-found') {
    renderEssayNotFound(notFoundKey);
    return;
  }
  const y = window.scrollY;
  renderEssayPage(official, socialProof);
  setEssayPageTitle(official);
  if (cached) window.scrollTo(0, y);
}

// Phase 2 of an Essay Page load: once the body has painted, await the social
// proof and fold it into the already-rendered page. No-op when the essay isn't
// official or the user has navigated away. official is passed as the cached
// anchor so the re-render restores scroll position (ADR 0006 #5).
async function foldInEssaySocialProof({ official, essay, curation, socialProofPromise, routeKey }) {
  if (!official) return;
  const socialProof = await socialProofPromise;
  if (!isEssayRouteActive(routeKey)) return;
  applyEssayPageRevalidation({
    cached: official, official, essay, curation, socialProof,
    notFoundKey: routeKey.coordinate ?? routeKey.slug,
  });
}

async function renderEssayView(coordinateString) {
  const coordinate = parseCoordinate(coordinateString);
  if (!coordinate) {
    renderEssayNotFound(coordinateString);
    return;
  }
  // SWR: when Discovery has already cached this essay (full body included),
  // paint it on the first frame instead of spinning; relays only revalidate.
  const cached = getCachedOfficialEssay({ coordinate: coordinateString });
  if (cached) {
    renderEssayPage(cached);
    setEssayPageTitle(cached);
  } else {
    renderEssayLoading();
  }
  // Start social proof in parallel but don't let it gate the body paint.
  const socialProofPromise = fetchSocialProof(coordinateString, { pool: sharedPool });
  // Fetch the Essay content and the brand curation list together. The list is
  // the official index: an Essay is shown only when its coordinate is on it.
  const [essay, curation] = await Promise.all([
    fetchEssayByCoordinate(coordinate, { pool: sharedPool }),
    fetchCurationList({ pool: sharedPool }),
  ]);
  // The user may have navigated elsewhere while we awaited the relays — only
  // commit this view if the essay route is still the active one.
  if (!isEssayRouteActive({ coordinate: coordinateString })) return;
  // Gate on curation: only a curated coordinate renders as an official Cinema
  // Slime Essay, carrying the brand-approved author name. Anything else (an
  // author's other writing, a brand-key note) is treated as unavailable.
  const official = selectCuratedEssay(essay, curation);
  // Paint body (or not-found) immediately — social proof is not yet available.
  applyEssayPageRevalidation({
    cached, official, essay, curation,
    socialProof: ZERO_SOCIAL_PROOF,
    notFoundKey: coordinateString,
  });
  await foldInEssaySocialProof({
    official, essay, curation, socialProofPromise,
    routeKey: { coordinate: coordinateString },
  });
}

async function renderEssayBySlug(slug) {
  // SWR fast path: Discovery entries carry the brand slug, so a cached essay
  // paints immediately even before the slug → coordinate hop resolves.
  const cached = getCachedOfficialEssay({ slug });
  if (cached) {
    renderEssayPage(cached);
    setEssayPageTitle(cached);
  } else {
    renderEssayLoading();
  }
  // Resolve slug → coordinate via the curation list, then fetch the Essay.
  // This is one serial hop vs. the coordinate fast path, but slugs are the
  // brand-chosen pretty URL so the extra round-trip is acceptable.
  const curation = await fetchCurationList({ pool: sharedPool });
  const coordinateString = curation.slugToCoordinate?.get(slug);
  if (!coordinateString) {
    if (!isEssayRouteActive({ slug })) return;
    // No coordinate for the slug + an empty curation is a relay failure
    // (fail-closed), not a removal — keep a cached copy on screen.
    if (cached && !(curation.coordinates?.size > 0)) return;
    renderEssayNotFound(slug);
    return;
  }
  const coordinate = parseCoordinate(coordinateString);
  // Start social proof in parallel with the essay fetch; don't let it gate the body.
  const socialProofPromise = fetchSocialProof(coordinateString, { pool: sharedPool });
  const essay = await fetchEssayByCoordinate(coordinate, { pool: sharedPool });
  if (!isEssayRouteActive({ slug })) return;
  const official = selectCuratedEssay(essay, curation);
  // Paint body immediately without social proof.
  applyEssayPageRevalidation({
    cached, official, essay, curation,
    socialProof: ZERO_SOCIAL_PROOF,
    notFoundKey: slug,
  });
  await foldInEssaySocialProof({
    official, essay, curation, socialProofPromise,
    routeKey: { slug },
  });
}

async function renderCurrentView() {
  // Flush held fresh data on any navigation — user is no longer mid-interaction.
  flushPendingEpisodes();
  flushPendingEssays();
  const route = parseHash(window.location.hash);
  if (route.type === 'episode' && route.guid) {
    const ep = getEpisodeByIdentifier(route.guid, episodes);
    if (ep) {
      renderEpisodePage(ep);
      setEpisodePageTitle(ep);
    } else {
      const app = document.getElementById('app');
      app.innerHTML = `
        <div class="grain-overlay"></div>
        ${renderNav()}
        <div class="episode-page" style="text-align:center;padding-top:4rem;">
          <a href="#" id="back-home" class="back-link" style="margin-bottom:2rem;display:inline-block;">← Back to all episodes</a>
          <h2 style="font-family:var(--font-display);letter-spacing:1px;">Episode not found</h2>
          <p style="color:var(--text-muted);">The episode may have been removed or the link is invalid.<br>Guid: <code style="font-size:0.8em;background:var(--bg-card);padding:2px 6px;border-radius:3px;">${route.guid}</code></p>
        </div>
        ${renderFooter()}
        ${renderStickyPlayer()}
      `;
      const bh = document.getElementById('back-home');
      if (bh) bh.addEventListener('click', (e) => { e.preventDefault(); navigateHome(); });
      const nh = document.getElementById('nav-home');
      if (nh) nh.addEventListener('click', (e) => { e.preventDefault(); navigateHome(); });
      bindPlayerEvents();
      restorePlayerUI();
      document.title = 'Episode not found | Cinema Slime Podcast';
    }
  } else if (route.type === 'essay' && route.coordinate) {
    await renderEssayView(route.coordinate);
  } else if (route.type === 'essay' && route.slug) {
    await renderEssayBySlug(route.slug);
  } else {
    render();
    restoreDocumentTitle();
    // Best-effort restore of Discovery View context (search query, filter, approx scroll) — slice #8
    if (savedScrollY > 0) {
      const y = savedScrollY;
      savedScrollY = 0;
      // Timeout 0 lets the browser paint the new DOM before we scroll
      setTimeout(() => {
        window.scrollTo({ top: y, behavior: 'auto' });
      }, 0);
    }
  }
}

function setupRouter() {
  window.addEventListener('hashchange', renderCurrentView);
}

async function init() {
  // Canonicalize a non-root boot path (a hash route whose '#' was deleted)
  // before the router reads location, so hash navigation never compounds
  // onto a stale path. replaceState fires no hashchange — no double render.
  const normalizedUrl = normalizeBootUrl(window.location);
  if (normalizedUrl !== null) history.replaceState(null, '', normalizedUrl);

  // Create and pre-warm the relay pool before any fetch so Essay queries
  // reuse one set of WebSocket connections instead of opening a fresh
  // fan-out per query (issue #82).
  sharedPool = createSharedPool();

  const episodesCache = createSWRCache(localStorage, BUILD_VERSION);
  const essaysCache = createSWRCache(localStorage, ESSAYS_SHAPE_VERSION);

  // Seed from cache so returning visitors see real content on the first frame.
  // Without a cache hit, episodes stays undefined and the shell paints skeletons.
  const cachedEpisodes = episodesCache.read(EPISODES_CACHE_KEY);
  if (cachedEpisodes && cachedEpisodes.length > 0) {
    setEpisodes(cachedEpisodes);
  }

  // Seed essays from cache so returning visitors see them on the first frame.
  // Without a cache hit, officialEssays stays undefined and the section shows a spinner.
  const cachedEssays = essaysCache.read(ESSAYS_CACHE_KEY);
  if (cachedEssays !== null) {
    officialEssays = cachedEssays;
  }

  // Cold start (no localStorage cache): seed from the same-origin snapshot before
  // the first render so a deep-linked Essay paints from the snapshot instead of
  // spinning while relay connections open. The nginx edge cache serves both
  // /api/essays/* paths in <50 ms; awaiting it here costs negligible wall-clock
  // vs a 5-10 s relay spinner. Falls back to the existing relay path on failure.
  if (officialEssays === undefined) {
    const snapshotEssays = await fetchEssaysSnapshot();
    if (snapshotEssays !== null) {
      officialEssays = snapshotEssays;
      essaysCache.write(ESSAYS_CACHE_KEY, snapshotEssays);
    }
  }

  // Render the shell immediately — skeletons (first visit) or cached content
  // (returning visitor) fill the Episode grid and hero without a blocking spinner.
  setupRouter();
  renderCurrentView();

  // Fetch essays in the background and revalidate the cache. Fresh data is applied
  // only when it differs AND the visitor is not scrolled into the essays section.
  // A relay failure on a warm start keeps the cached essays on screen.
  fetchEssaysForDiscovery({ pool: sharedPool }).then(freshEssays => {
    if (freshEssays === null) {
      // Relay failure. On a cold start (no cache), show the failure state.
      // On a warm start, keep cached essays visible — don't overwrite with null.
      if (officialEssays === undefined) {
        officialEssays = null;
        refreshEssaysGrid();
      }
      return;
    }
    essaysCache.write(ESSAYS_CACHE_KEY, freshEssays);

    const { decision, reason } = shouldApplyFreshData({
      cached: officialEssays,
      fresh: freshEssays,
      interacting: { searching: false, scrolled: isScrolledInto('essays') },
      idKey: 'coordinate',
    });

    if (decision === 'hold') {
      if (reason === 'interacting') pendingEssays = freshEssays;
      return;
    }

    officialEssays = freshEssays;
    refreshEssaysGrid();
  });

  // Revalidate RSS in the background; update cache + DOM only when content changed
  // and the visitor is not actively interacting (searching or scrolled into the grid).
  fetchRSS().then(freshEpisodes => {
    if (!freshEpisodes.length) {
      // Fetch failed or empty. On a cold first load (no cache) swap the
      // skeletons for the empty state; with warm content, keep what we have.
      if (episodes === undefined) {
        setEpisodes([]);
        renderCurrentView();
      }
      return;
    }
    episodesCache.write(EPISODES_CACHE_KEY, freshEpisodes);

    const interacting = {
      searching: searchQuery.length > 0,
      scrolled: isScrolledInto('episodes'),
    };
    const { decision, reason } = shouldApplyFreshData({ cached: episodes, fresh: freshEpisodes, interacting });

    if (decision === 'hold') {
      // Store for later if data changed but the visitor is mid-interaction;
      // flushed on next navigation or when search is cleared.
      if (reason === 'interacting') pendingEpisodes = freshEpisodes;
      return;
    }

    setEpisodes(freshEpisodes);

    // Patch in place to avoid a full-page re-render flicker; fall back to a
    // full render for non-home routes (e.g. an episode deep-link).
    const route = parseHash(window.location.hash);
    if (route.type === 'home') {
      const heroDynamic = document.getElementById('hero-dynamic');
      if (heroDynamic) {
        heroDynamic.innerHTML = renderHeroDynamic();
        bindHeroLatest();
      }
      refreshEpisodesGrid();
    } else {
      renderCurrentView();
    }
  });
}

init();
