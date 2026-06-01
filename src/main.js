import './style.css';
import { getEpisodeByIdentifier } from './episode-data.js';
import { parseHash, navigateToEpisode, navigateHome, buildEpisodeHash } from './router.js';
import { normalizeDescription } from './description-normalizer.js';
import { parseCoordinate } from './essay-coordinate.js';
import { fetchEssayByCoordinate } from './nostr-pool.js';

const RSS_URL = 'https://anchor.fm/s/1050fb0e4/podcast/rss';
const SHOW_ART = 'https://d3t3ozftmdmh3i.cloudfront.net/staging/podcast_uploaded_nologo/43698817/43698817-1757516582372-2a574ca9eaf8e.jpg';
const LOGO = '/cs-logo.png';

// Race multiple proxies for speed — first one to respond wins
const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

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

let episodes = [];
let filteredEpisodes = [];
let currentFilter = 'all';
let searchQuery = '';
let audioPlayer = null;
let currentEpisode = null;
let savedScrollY = 0;

const ORIGINAL_TITLE = document.title;

// ===== RSS PARSER =====
async function fetchWithRace(url) {
  // Try direct first (might work if CORS is allowed)
  const directFetch = fetch(url).then(r => { if (!r.ok) throw new Error('Direct failed'); return r.text(); });
  // Race all proxies
  const proxyFetches = CORS_PROXIES.map(proxy =>
    fetch(proxy(url)).then(r => { if (!r.ok) throw new Error('Proxy failed'); return r.text(); })
  );
  return Promise.any([directFetch, ...proxyFetches]);
}

function parseRSSText(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'text/xml');
  const items = xml.querySelectorAll('item');

  return Array.from(items).map(item => {
    const getText = (tag) => {
      const el = item.querySelector(tag);
      return el ? el.textContent.trim() : '';
    };
    const getItunes = (tag) => {
      const el = item.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', tag)[0];
      return el ? (el.getAttribute('href') || el.textContent.trim()) : '';
    };
    const enc = item.querySelector('enclosure');

    return {
      title: getText('title'),
      pubDate: getText('pubDate'),
      description: getText('description'),
      audioUrl: enc ? enc.getAttribute('url') : '',
      image: getItunes('image') || SHOW_ART,
      duration: getItunes('duration'),
      episode: getItunes('episode'),
      season: getItunes('season'),
      episodeType: getItunes('episodeType') || 'full',
      link: getText('link'),
      guid: getText('guid').trim(),
    };
  });
}

async function fetchRSS() {
  try {
    const text = await fetchWithRace(RSS_URL);
    episodes = parseRSSText(text);
    filteredEpisodes = [...episodes];
    return episodes;
  } catch (err) {
    console.error('RSS fetch error:', err);
    return [];
  }
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
    ${renderAbout()}
    ${renderSubscribe()}
    ${renderFooter()}
    ${renderStickyPlayer()}
  `;
  bindEvents();
  observeAnimations();
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

function renderHero() {
  const epCount = episodes.length;
  const latest = episodes.find(e => e.episodeType === 'full') || episodes[0];
  const latestIdx = latest ? episodes.indexOf(latest) : 0;
  const label = latest ? getEpLabel(latest) : '';
  const desc = latest ? getShortDescription(latest.description) : '';

  // Dynamically compute tile count from viewport size
  const allThumbs = episodes
    .filter(e => e.image !== SHOW_ART)
    .map(e => e.image)
    .sort(() => Math.random() - 0.5);
  const tileSize = 270;
  const containerW = window.innerWidth * 1.1; // 110% for bleed
  const containerH = window.innerHeight;
  const cols = Math.ceil(containerW / tileSize) + 1;
  const rows = Math.ceil(containerH / tileSize) + 1;
  const totalTiles = cols * rows;
  // Cycle through episode images to fill
  const tiles = [];
  for (let i = 0; i < totalTiles; i++) {
    tiles.push(allThumbs[i % allThumbs.length]);
  }

  const tilesHtml = tiles.map((src) => {
    return `<img class="hero-bg-tile" src="${src}" alt="" loading="lazy" />`;
  }).join('');

  return `
    <section class="hero" id="hero">
      <div class="hero-bg-tiles">${tilesHtml}</div>
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

function renderEpisodeCards() {
  if (!filteredEpisodes.length) {
    return '<p style="text-align:center;color:var(--text-muted);grid-column:1/-1;padding:3rem;">No episodes found.</p>';
  }
  return filteredEpisodes.map((ep, i) => {
    const realIdx = episodes.indexOf(ep);
    const label = getEpLabel(ep);
    const isBonus = ep.episodeType !== 'full';
    return `
      <article class="episode-card animate-in" data-idx="${realIdx}">
        <div class="episode-card-art">
          <img src="${ep.image}" alt="${cleanTitle(ep.title)}" loading="lazy" />
          <div class="episode-card-play">${icons.play}</div>
          ${isBonus ? `<span class="episode-card-type">${ep.episodeType}</span>` : ''}
        </div>
        <div class="episode-card-body">
          ${label ? `<p class="card-ep">${label}</p>` : ''}
          <h3>${cleanTitle(ep.title)}</h3>
          <div class="card-meta">
            <span>${formatDate(ep.pubDate)}</span>
            <span>${ep.duration || ''}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');
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

  document.querySelectorAll('.episode-card').forEach(card => {
    const idx = parseInt(card.dataset.idx);
    const playEl = card.querySelector('.episode-card-play');
    if (playEl) {
      playEl.addEventListener('click', (e) => {
        e.stopPropagation();
        playEpisode(idx);
      });
    }
    card.addEventListener('click', () => {
      const ep = episodes[idx];
      if (ep && ep.guid) goToEpisodePage(ep.guid);
    });
  });

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

function applyFilters() {
  filteredEpisodes = episodes.filter(ep => {
    const matchType = currentFilter === 'all' || ep.episodeType === currentFilter;
    const matchSearch = !searchQuery || 
      ep.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ep.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchSearch;
  });
  const grid = document.getElementById('episodes-grid');
  if (grid) {
    grid.innerHTML = renderEpisodeCards();
    grid.querySelectorAll('.episode-card').forEach(card => {
      const idx = parseInt(card.dataset.idx);
      const playEl = card.querySelector('.episode-card-play');
      if (playEl) {
        playEl.addEventListener('click', (e) => {
          e.stopPropagation();
          playEpisode(idx);
        });
      }
      card.addEventListener('click', () => {
        const ep = episodes[idx];
        if (ep && ep.guid) goToEpisodePage(ep.guid);
      });
    });
    observeAnimations();
  }
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
function setEssayPageTitle(essay) {
  document.title = `${essay.title || 'Essay'} | Cinema Slime`;
}

// Minimal, safe body rendering for the tracer slice: escape everything, then
// honor paragraph/line breaks. Rich markdown + image/YouTube embeds are #31.
function renderEssayBody(text) {
  const safe = escapeHtml(text || '');
  const paras = safe.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) {
    return '<p style="color:var(--text-muted);font-style:italic;">This Essay has no content yet.</p>';
  }
  return paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
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

function renderEssayPage(essay) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="grain-overlay"></div>
    ${renderNav()}
    <div class="episode-page essay-page">
      <a href="#" id="back-from-essay" class="back-link">← Back to Cinema Slime</a>
      <div class="episode-header essay-header">
        <div class="episode-meta">
          <span class="episode-label">ESSAY</span>
          <h1 class="episode-title">${escapeHtml(essay.title || 'Untitled')}</h1>
          <p class="episode-date">${formatDate(essay.publishedAt * 1000)}</p>
        </div>
      </div>
      <div class="episode-content">
        <div class="episode-description essay-body">
          ${renderEssayBody(essay.body)}
        </div>
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

async function renderEssayView(coordinateString) {
  const coordinate = parseCoordinate(coordinateString);
  if (!coordinate) {
    renderEssayNotFound(coordinateString);
    return;
  }
  renderEssayLoading();
  const essay = await fetchEssayByCoordinate(coordinate);
  // The user may have navigated elsewhere while we awaited the relays — only
  // commit this view if the essay route is still the active one.
  const current = parseHash(window.location.hash);
  if (current.type !== 'essay' || current.coordinate !== coordinateString) return;
  if (essay) {
    renderEssayPage(essay);
    setEssayPageTitle(essay);
  } else {
    renderEssayNotFound(coordinateString);
  }
}

async function renderCurrentView() {
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
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="grain-overlay"></div>
    <div class="loader" style="min-height:100vh;">
      <div class="loader-spinner"></div>
      <p class="loader-text">Loading the slime...</p>
    </div>
  `;
  await fetchRSS();
  setupRouter();
  renderCurrentView();
}

init();
