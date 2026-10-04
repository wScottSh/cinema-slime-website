# Link Previews for Episode and Essay Pages

**Date**: 2026-10-04
**Status**: accepted
**Depends on**: clean-URL routing (draft PR #185), which replaces ADR 0001's `#/episode/<guid>` hash routes with `/episode/<guid>` and `/essay/<slug-or-coordinate>` paths
**Context**: A link to any page on the site, posted in Discord, unfurled as the same generic card: "Cinema Slime Podcast", the show art, the site blurb. The ask was a preview of the page actually linked: its own image, its own text, and a readable, templated title.

---

## Context / problem

Two things made every preview generic, and either one alone would have been enough:

1. **The address.** Pages lived behind the `#` (`/#/episode/<guid>`). Browsers and crawlers never send the fragment to the server, so every shared link was a request for `/`.
2. **The tags.** The page's title is set by JavaScript after load, and the Open Graph tags were hardcoded in `index.html`. Link unfurlers (Discord, Slack, iMessage, X) read the HTML the server sends and do not run JavaScript.

Clean-URL routing (PR #185) fixes the first. This ADR fixes the second.

## Decisions

### 1. One static copy of index.html per page, rendered ahead of time

`scripts/render-share-pages.mjs` writes `episode/<guid>/index.html` and `essay/<slug-or-coordinate>/index.html`. Each is the built `index.html` with that page's `<title>`, description, canonical link, Open Graph and Twitter Card tags. The SPA boots from it exactly as it does from `index.html`; only the `<head>` differs.

Alternatives considered:

- **A long-running Node service on the droplet that renders tags per request.** It would be fresh to the second, but it adds a process to run, monitor and restart, and a new failure mode in front of every page. The site's server side has been nginx serving static files plus caching proxies (ADRs 0006, 0008, 0013). This keeps it that way.
- **nginx `sub_filter` / njs.** njs is not installed, and string substitution in nginx cannot parse the feed.
- **Dynamic rendering only for crawler user agents.** It is fragile (every unfurler has its own UA) and it serves crawlers different content from people.

### 2. Rendered at deploy, refreshed hourly

The deploy renders all pages after `vite build`. Episodes and Essays also arrive without a deploy, so `refresh-share-pages.yml` re-renders every hour and swaps just the `episode/` and `essay/` directories into the web root.

The refresh uses the **live** `index.html` as its template rather than rebuilding, so a page can never reference asset hashes that are not on the droplet. `injectShareMeta` is idempotent so that the live page, which is itself an injected template, works as a template.

The cost is that a new Episode unfurls with the site-wide preview for up to about an hour. The page itself works the whole time.

### 3. nginx serves the page file directly

`cinemaslime-share-location.conf` adds `location ~ ^/(episode|essay)/[^/]+$ { try_files $uri/index.html /index.html; }`. The existing SPA fallback (`try_files $uri $uri/ /index.html`) would find the directory and answer **301 → `/episode/<guid>/`**. That was verified against `nginx:stable`: an extra round trip on every shared link, to a URL the client then has to un-slash. A path with no rendered page still falls through to `index.html`.

### 4. What the preview says

| | Episode Page | Essay Page |
|---|---|---|
| `og:title` | `<cleaned title> · S2E19` (`· E39` for season-less, `· Bonus`, `· Trailer`) | `<title> — by <Cinema Slime Name>` |
| `<title>` | `<cleaned title> \| Cinema Slime Podcast`, the same as the client sets | `<title> \| Cinema Slime`, the same as the client sets |
| description | the billing (`RENN'S PICK x DAD-TEMBER`) — then the synopsis, via `parseShowNotes`; else the quote; else the site blurb. ≤200 chars, word boundary | the Essay's `summary`; else the opening body text with Markdown, headings and URLs stripped |
| image | the Episode's artwork, 640px same-origin derivative (ADR 0013), absolute URL | the Cover Image (`resolveCoverImage`, ADR 0009) when it is a real https URL; else the show art. A Film Leader is generated markup, not an image file, so it cannot be used |
| `og:url` / canonical | `/episode/<guid>` | the Slug URL when there is one, else the coordinate URL; both addresses get a page, and both point here |

`twitter:card` is `summary_large_image` everywhere, so Discord and X show the image large instead of as a thumbnail. `og:site_name` is "Cinema Slime Podcast".

### 5. Failure is never a gate

If the feed or the relays are unreachable during a render, that source is skipped, the other still renders, and the script exits 1. In the deploy, the step is `continue-on-error`, so a feed outage never blocks shipping code. In the refresh, a directory that was not rendered is not swapped, so an outage never wipes pages that are already live, and the job then fails so the outage is visible.

## Consequences

- New `src/share-meta.js` holds the pure builders and tag injection, with colocated `node --test` tests.
- New `scripts/render-share-pages.mjs` (`npm run build:share`), `deploy/nginx/cinemaslime-share-location.conf`, and `.github/workflows/refresh-share-pages.yml`.
- `deploy-live.yml` runs on Node 22, because the relay read needs a global `WebSocket`. It renders after the build and, after cutover, fetches one Episode Page as Discordbot and requires the page's own `og:url` back. Both workflows share the `droplet-webroot` concurrency group.
- `index.html` gains `og:site_name`, `og:url`, `og:image:alt`, canonical and `twitter:card` for the home page.
- Old `#/` links already posted keep the generic preview forever. The fragment never reaches the server, so nothing can be done about that.
- Unfurlers cache previews. A link posted before its page was rendered may keep the generic card in that channel for a while.
- GitHub pauses scheduled workflows after 60 days with no repository activity. A push or a manual run re-arms it.
