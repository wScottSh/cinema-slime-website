# The droplet's nginx config is owned by CI

**No human maintains the nginx box.** Every byte of Cinema Slime's nginx
configuration lives in `deploy/nginx/` in this repo and is installed onto the
droplet by `.github/workflows/deploy-live.yml` on every push to `live`. If you
find yourself SSH'ing in to paste a `location` block, something has gone wrong —
see [Break glass](#break-glass-emergency-only) at the bottom.

## Why this document exists

For a long time the config *looked* CI-managed: the `.conf` files were committed,
and the per-feature docs (`nginx-rss-proxy.md`, `nginx-essays-proxy.md`,
`nginx-artwork-proxy.md`) each ended with an "Apply to the droplet" section. But
those sections instructed a **human** to `scp` files and paste blocks into
`/etc/nginx/sites-available/cinemaslime.com`, and nothing anywhere checked that
it had happened. On 2026-07-25 the bill came due — two simultaneous silent
production faults:

- The entire ADR 0013 artwork config was **absent from the box**. Every
  `/api/art/` request 404'd site-wide. Nothing looked broken: the client degrades
  to a dark placeholder, so the site just looked empty.
- The ADR 0008 essays config had **never been applied at all**.
  `/api/essays/curation` and `/api/essays/events` returned `200 text/html` — the
  SPA shell — instead of JSON. The edge-cached snapshot had therefore never
  worked in production, and the site had been silently falling back to the slow
  relay path since the feature shipped.

Both failure modes are invisible from outside. That is the argument for
mechanising this: the config being correct is not something anyone can *see*.

## The pieces

| File | What it is |
| --- | --- |
| `deploy/nginx/install-edge-config.sh` | The idempotent installer that runs **on the droplet**. |
| `deploy/nginx/*-cache.conf` | `http{}`-context config (cache zones, the loopback resize server). Installed to `/etc/nginx/conf.d/`. |
| `deploy/nginx/*-location.conf` | `server{}`-context `location` blocks. Installed to `/etc/nginx/snippets/` and `include`d from the managed marker block. |
| `.github/workflows/deploy-live.yml` | build → install edge config → **verify** → cut over `dist/` → warm artwork → verify again. |
| `.github/workflows/verify-edge.yml` | The same verification on a 6-hourly cron, because drift happens without deploys. |
| `scripts/verify-edge-contract.mjs` (`npm run verify:edge`) | The contract itself, as executable assertions — see [`edge-contract.md`](edge-contract.md). |

This document covers how the config gets **onto the box**;
[`edge-contract.md`](edge-contract.md) covers what is then asserted about it from
the outside. The two are the halves of the same guarantee.

Membership is derived from what is in `deploy/nginx/`, not from a list inside the
installer. Adding `deploy/nginx/cinemaslime-foo-location.conf` is the whole
change needed to get a new snippet installed and included.

## What the installer does

1. Installs `libnginx-mod-http-image-filter` if absent
   (`DEBIAN_FRONTEND=noninteractive`; a no-op once present).
2. Creates every directory named in a `proxy_cache_path` and chowns it to the
   nginx user.
3. Syncs `*-cache.conf` → `/etc/nginx/conf.d/` and `*-location.conf` →
   `/etc/nginx/snippets/`, and **reaps** any `cinemaslime-*.conf` on the box that
   the repo no longer ships.
4. Replaces the marker block in the HTTPS `server{}` of the vhost:

   ```nginx
   # >>> cinemaslime managed by CI >>>
   include /etc/nginx/snippets/cinemaslime-art-location.conf;
   include /etc/nginx/snippets/cinemaslime-essays-location.conf;
   include /etc/nginx/snippets/cinemaslime-llms-location.conf;
   include /etc/nginx/snippets/cinemaslime-rss-location.conf;
   # <<< cinemaslime managed by CI <<<
   ```

   The block is always (re)inserted **immediately before `location / {`**. On a
   re-run the existing block is removed and re-emitted at that canonical
   position, so a block someone moved by hand is silently hoisted back.
5. **Migrates hand-pasted inline blocks.** On its first run it removes any inline
   `location` in the vhost whose signature a snippet now defines — the box
   carried inline `location = /api/rss { … }` and `location = /llms.txt { … }`,
   and including the snippets without removing those would make nginx refuse to
   start with *duplicate location*. It also removes any stray
   `include …/cinemaslime-*.conf;` line that lives outside the markers. The block
   spans are found by a quote- and comment-aware brace scanner, not a regex.
6. Backs up the vhost **and every managed conf** to
   `/var/backups/cinemaslime-edge/<UTC timestamp>/`, runs `nginx -t`, and on
   failure restores all of it and exits non-zero **without reloading**. On
   success, `systemctl reload nginx`.

Certbot's `ssl_*` / `listen 443` lines are never touched. The installer only ever
edits its own marker block and removes locations it is taking ownership of.

### Ordering is the load-bearing part

nginx picks the **first matching regex location in file order**. The vhost ends
with a static-asset regex location, `location ~* \.(js|css|png|jpg|…)$`. An
artwork derivative URI ends in `.jpg`. So:

- The managed block **must** sit before `location / {` (and therefore before the
  static-asset regex). Below it, every derivative 404s — silently.
- `location ^~ /_art/` needs its `^~`: nginx tests regex locations before
  falling back to a remembered plain prefix, so without it the static regex
  steals the internally-rewritten URI.
- Exact matches (`location = /api/rss`, `location = /llms.txt`,
  `location = /api/essays/curation`, `location = /api/essays/events`) are immune
  — an exact match wins outright and no regex is ever tested. They need no `^~`
  and no particular placement.

Both of the 2026-07-25 faults were ordering/presence failures of exactly this
kind, which is why they are enforced by the installer rather than described in
prose.

## Reviewing a change before it ships

`--dry-run` prints the planned file syncs and the **entire resulting vhost**
without writing, installing, or reloading anything:

```sh
# On the droplet, against the real vhost (read-only; safe):
scp deploy/nginx/*.conf deploy/nginx/install-edge-config.sh root@161.35.188.75:/tmp/edge/
ssh root@161.35.188.75 'bash /tmp/edge/install-edge-config.sh --dry-run --payload /tmp/edge'
```

Locally against a fixture vhost, every path is overridable — this is how the
rewriting logic is tested without touching production:

```sh
EDGE_VHOST=/tmp/fixture/cinemaslime.com \
EDGE_CONFD=/tmp/fixture/conf.d \
EDGE_SNIPPETS=/tmp/fixture/snippets \
EDGE_BACKUP_ROOT=/tmp/fixture/backups \
EDGE_CACHE_PREFIX=/tmp/fixture/cache \
EDGE_SKIP_PACKAGES=1 \
EDGE_NGINX_TEST_CMD=true EDGE_NGINX_RELOAD_CMD=true \
  bash deploy/nginx/install-edge-config.sh --payload deploy/nginx
```

| Variable | Default |
| --- | --- |
| `EDGE_VHOST` | `/etc/nginx/sites-available/cinemaslime.com` |
| `EDGE_CONFD` | `/etc/nginx/conf.d` |
| `EDGE_SNIPPETS` | `/etc/nginx/snippets` |
| `EDGE_BACKUP_ROOT` | `/var/backups/cinemaslime-edge` |
| `EDGE_CACHE_PREFIX` | *(empty)* — prepended to every `proxy_cache_path` dir |
| `EDGE_NGINX_TEST_CMD` | `nginx -t` |
| `EDGE_NGINX_RELOAD_CMD` | `systemctl reload nginx` |
| `EDGE_SKIP_PACKAGES` | `0` |
| `EDGE_NGINX_USER` | `www-data` |
| `EDGE_PAYLOAD_DIR` | *(none)* — equivalent to `--payload` |

## Testing the installer

```sh
npm run test:installer     # bash deploy/nginx/test/run-installer-tests.sh
```

The installer is the one artifact here that can take the site down without any
code changing, so its behaviour is pinned by tests rather than by prose. The
harness runs the installer against a fixture copy of the **real production
vhost as it stood before the first CI-owned install** (two `server` blocks,
certbot's lines, hand-pasted inline `rss`/`llms` locations, one stray art
include outside the markers) with every `EDGE_*` path pointed at a throwaway
`mktemp` dir. Nothing touches the network, ssh, or anything outside the repo.

| File | What it is |
| --- | --- |
| `deploy/nginx/test/run-installer-tests.sh` | The harness. Self-contained; builds its own payloads. |
| `deploy/nginx/test/fixtures/vhost-real.conf` | The pre-migration production vhost. |

The payload is **derived at run time** from `deploy/nginx/*.conf`, so the tests
always exercise the config this checkout actually ships. The whole suite runs
twice — once against an LF payload and once against a CRLF one, manufactured on
the fly (git normalises CRLF away; `.gitattributes` pins `deploy/nginx/**` to
LF precisely to keep it off the droplet). 29 assertions per payload, 58 total:

- **Migration**: the inline `location = /api/rss` and `location = /llms.txt`
  blocks and their now-orphaned comment headers are removed; the stray art
  `include` outside the markers is removed; exactly one art include remains and
  it is inside the markers.
- **Placement**: the marker block lands immediately before `location / {`, all
  four includes inside it, both `server` blocks survive, and every
  `# managed by Certbot` line comes out byte-identical.
- **Idempotency**: runs 2 and 3 are byte-identical to run 1.
- **Duplicate locations**: zero, checked against the vhost with every managed
  include expanded in place — the only form of the check nginx would agree with.
- **Fail-closed**: with `EDGE_NGINX_TEST_CMD=false` the run exits non-zero, the
  vhost, snippets and `conf.d` are restored exactly as found (including a stale
  snippet the run had reaped), and nginx is never reloaded.
- **Preflight**: a fault-injected copy of the installer with the
  inline-location removal branch neutered — the exact reported failure, where
  includes get added but the inline blocks survive — is caught by the
  duplicate-location preflight with *nothing written*.
- **Scanner edge cases**: a one-line `location = /llms.txt { … }` is removed
  without deleting to EOF and without touching an unmanaged single-line block;
  an unterminated block aborts non-zero and writes nothing.

`.github/workflows/ci.yml` runs `npm test` and `npm run test:installer` on every
pull request and on pushes to `main`. Run it there as well as locally: the
runner's `awk` is **mawk**, and the CRLF/`\{` traps this suite exists to catch
only manifest on mawk — a gawk dev machine will pass a payload that would have
brought production down.

## Drift detection

`.github/workflows/verify-edge.yml` runs `npm run verify:edge` against production
every 6 hours and on demand. Deploy-time checks alone are insufficient because
drift does not need a deploy to happen: an emergency hand edit, an
unattended-upgrades run that stops loading the image-filter module, a wiped cache
directory. None of those produce an error page — they degrade quietly, which is
precisely how the essays endpoint went unnoticed.

**When it fires, the fix is almost always to re-run the deploy workflow** (or the
installer directly). It is idempotent and re-imposes the repo's config.

## Break glass (emergency only)

Manual steps are for the case where CI itself is unavailable and the site is
down. They are **not** the normal path, and anything you do by hand here will be
overwritten by the next deploy — which is the desired behaviour, not a hazard.
Any fix worth keeping must be made in `deploy/nginx/` and pushed.

```sh
KEY=~/.ssh/id_ed25519_cinemaslime_droplet
HOST=root@161.35.188.75

# Roll back to the state before the last installer run.
ssh -i "$KEY" $HOST 'ls -1 /var/backups/cinemaslime-edge | tail -5'
ssh -i "$KEY" $HOST 'B=/var/backups/cinemaslime-edge/<STAMP>; \
  cp -a $B/vhost /etc/nginx/sites-available/cinemaslime.com && \
  cp -a $B/conf.d/*.conf /etc/nginx/conf.d/ 2>/dev/null; \
  cp -a $B/snippets/*.conf /etc/nginx/snippets/ 2>/dev/null; \
  nginx -t && systemctl reload nginx'

# Run the installer by hand (same thing CI does).
scp -i "$KEY" deploy/nginx/*.conf deploy/nginx/install-edge-config.sh $HOST:/tmp/edge/
ssh -i "$KEY" $HOST 'bash /tmp/edge/install-edge-config.sh --payload /tmp/edge'
```

Editing the vhost by hand is a last resort. If you must: keep your edit **outside**
the `# >>> cinemaslime managed by CI >>>` markers (the next run replaces
everything between them), and remember that an inline `location` duplicating one
a snippet defines will be removed by the next installer run — deliberately, since
that is the migration path that unwound the original hand-pasted config.
