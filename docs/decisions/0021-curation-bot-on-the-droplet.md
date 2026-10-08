# The Curator: a Discord bot on the droplet that owns Curation edits

**Date**: 2026-10-07
**Status**: accepted
**Amends**: ADR 0006 (no app server on the droplet), ADR 0020 (rejected a long-running Node process for Link Previews)
**Context**: Curating an Essay took a git edit to `ESSAYS` in `scripts/publish-curation.mjs`, a local wizard that signed and published the kind:30001 Curation with the brand key, and up to ~80 minutes for the hourly refresh to write the Essay Page's Link Preview. The ask: @mention a bot in #admin-convos with a Nostr link, and get back the Cinema Slime link with a correct Discord card.

---

## Context / problem

- Receiving @mentions needs a Gateway (websocket) bot. Incoming webhooks only post, and HTTP interactions see slash commands, not mentions. So something has to run continuously.
- The live kind:30001 is what the site reads. The git `ESSAYS` array was a second copy. A bot that published without updating git would be silently undone by the next wizard run, which republished the stale git list.
- A missing Essay Page is not a 404: nginx's share location falls through to `index.html`, which returns 200 with the site-wide tags. Verification has to compare `og:url` and `og:title`, not the status.
- Discord caches an unfurl per URL. If a link is posted before its page exists, the generic card sticks.

## Decisions

### 1. The live Curation is the only list

`ESSAYS`/`NAMES`, `scripts/publish-curation.{mjs,sh,ps1}`, `npm run publish:curation`, the git diff in `check-curation`, and the `curate-essay` extractor and `publish-curation` skills are deleted. Every change is a read-modify-write of the newest signed Curation.

- `src/curation.js` holds the Curation as a domain value (`{ entries: [{ coordinate, slug }], names, createdAt, eventId }`). `curationFromEvent`/`curationToTags` are the only code that reads or writes its `a`/`p` tags for an edit, and the codec refuses a list with duplicate coordinates or slugs.
- `readCuration` collects the brand-signed event from every brand relay, waiting for each relay's EOSE or the 8 s cap instead of settling early, plus the bot's own last-published copy (`/var/lib/cinemaslime-bot/curation.json`). The newest is the base. The Curator refuses, and publishes nothing, when:
  - nothing answers (`curation-unreadable`). It never builds a list from an empty read, which would delist every Official Essay.
  - any copy lists a coordinate the base lacks (`curations-disagree`). There is no remove verb, so a base that is not a superset means a lagging copy won, and publishing it would delist Essays. The refusal persists until the disagreeing copies converge; nothing in the bot overrides it.
  - the base is older than `curation-floor.json`, the highest `created_at` this machine has read or published (`curation-stale`). This catches relays that lag behind the bot's own last publish after the local copy is lost. On a fresh install with no floor and no local copy, a list that every answering relay holds stale is still taken as the base; that window closes after the first read.
- A new Curation's `created_at` is `max(now, previous + 1)`, so it always replaces the one it was edited from.
- `vault/essays/` stays in git as the seed for the droplet vault (`/var/lib/cinemaslime-bot/vault/essays`). After seeding, the droplet copy is primary and git lags. Syncing it back to git is a follow-up.

### 2. An outbound-only Gateway bot runs on the droplet

`bot/` is a systemd service (`cinemaslime-bot`). It holds a Gateway websocket to Discord and talks to the Nostr relays. It opens no listening socket and serves no HTTP. That narrows ADR 0006: "no app server" now means "no inbound application server". It also supersedes ADR 0020's rejection of a long-running droplet Node process, for writing Essay Pages only. ADR 0020's per-request rendering stays rejected.

- `bot/curator.js` (`createCurator().run(command)`) is the deep module. It captures the Essay, reads the Curation, applies the pure edit (`applyCurate`/`applyRename`), publishes through the existing Guaranteed Presence gate only when the edit changed something, renders every Essay Page, and fetches its own page as `Discordbot/2.0` to require the right `og:url` and `og:title` (one re-render retry). It knows nothing about Discord.
- `bot/discord.js` is the only module that sees discord.js types. Only an explicit `<@bot>` mention, or a mention of the role Discord manages for the bot (`<@&role>`, which autocomplete offers when both share a name), by a human in the configured channel (`deploy/bot/config.json`) is accepted. An empty `allowedUserIds` admits anyone who can post in that private channel. Everything else is ignored without a reply.
- Runs are FIFO in-process and exclusive across processes through an O_EXCL pid lock in the state directory, which the break-glass CLI also takes. A per-message journal skips Gateway redeliveries and replays runs a crash interrupted. Every step converges, so a replay never double-publishes.
- Commands: curate (default), `rename`, `help`. A different `slug:` for a listed Essay is refused with a pointer to `rename`, because renaming breaks shared links. Remove and list were left out until needed.

### 3. The bot is one more writer of Essay Pages, not the only one

`scripts/render-share-pages.mjs` and the bot share one renderer, `src/share-pages.js`. The bot renders every page of the whole live Curation from its vault and the local live template (`html/index.html`) and swaps each file in by write-temp-and-rename. Deploys and the hourly refresh keep writing `html/essay/` from the relays. All three are projections of the same live Curation, so they converge.

- Accepted race: a deploy that lands mid-run can wipe the bot's fresh page until the next hourly refresh.
- Deploys and the refresh recreate `html/essay/` as root. Both now chown it to `cinemaslime-bot` (the user exists only after the first bot install), and the installer does the same once. A bot write that lands in the gap between a swap and its chown fails as a render error, and mentioning the bot again fixes it.
- The service binds `/var/www/cinemaslime/html` read-write rather than `html/essay`. The refresh replaces `essay/` by rename, which would leave a bind mount of `essay/` pointing at the deleted directory. Unix ownership keeps the bot's writes to `essay/`.

### 4. Reply and card verification

The bot reacts 👀 at once. It posts exactly one reply after its own page verifies, as a reply to the mention with `allowed_mentions: { parse: [] }` and the mention's id as an enforced nonce, so a replayed run does not post twice. It then watches `MESSAGE_UPDATE` for the reply's embed for 30 s. A matching title and URL is marked ✅. A generic or missing card gets one edit to `<url>?v=<curation created_at>` (nginx ignores the query, Discord unfurls it fresh) and a second 30 s wait. Otherwise the reply ends with ⚠️. It never claims ✅ without an observed matching card.

### 5. Secrets: GitHub secrets to systemd credentials

`BRAND_SECRET_KEY` (set by `scripts/setup-curation-key.sh`, which checks the key's pubkey is `BRAND_PUBKEY`) and `DISCORD_BOT_TOKEN` (set by `scripts/setup-discord-bot.sh`) are GitHub Actions secrets. `.github/workflows/deploy-bot.yml` streams each over SSH stdin into `/etc/cinemaslime-bot/credentials/` (root, 0600), and the unit loads them with `LoadCredential=`. They are never in the environment, on argv, or in the repo. The bot refuses to start with a key whose pubkey is not `BRAND_PUBKEY`.

Accepted risk: the brand key now lives on the droplet. A compromised bot can sign Curations and rewrite Essay Pages. The unit runs as a dedicated user with `ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`, an empty capability set, and write access only to its state directory and (by ownership) `html/essay/`. `systemd-analyze security` rates it 3.0 (OK).

### 6. Shipping: one vite SSR bundle and a pinned Node

`npm run build:bot` (`vite.bot.config.js`) bundles `bot/main.js` with discord.js and nostr-tools into `dist-bot/cinemaslime-bot.mjs` (about 3.3 MB). discord.js's optional native accelerators (`zlib-sync`, `bufferutil`, `utf-8-validate`) are left external, and it runs without them. The droplet needs no npm and no checkout. `deploy/bot/install-bot.sh` installs Node 22.23.3 from nodejs.org against the sha256 in `deploy/bot/node.sha256`, the bundle, the unit, the config, and the `cinemaslime-bot` CLI shim. It seeds the vault without overwriting, restarts only on change, and waits for `gateway ready`.

Spike evidence for the bundle (2026-10-07): it ran `--help` from a directory with no `node_modules`. A bundle of the same discord.js stack built with the same config reached the real Gateway (HELLO, heartbeat, IDENTIFY) and was closed with 4004 for a fake token. The alternative, an `npm ci --omit=dev` tarball, would ship a `node_modules` tree (discord.js alone adds 25 packages) and needs discord.js moved to `dependencies`; the bundle worked, so it was not built.

## Alternatives considered

- **The bot only receives; GitHub Actions does the work** (the bot dispatches a workflow to publish and render). The brand key would stay in GitHub, but a run takes 50–110 s plus queue lag, one operation spans three systems (Discord, Actions, the droplet), and the bot needs either a hand-rolled or duplicated GitHub token. Lost on latency and spread.
- **Keep git as the list and have the bot commit `ESSAYS`.** Needs a push credential on the droplet and rebase handling, and the stale-copy hazard returns whenever a human edits git. Lost on split ownership.
- **Make the bot the single writer of `html/essay/`** (deploy and refresh stop writing it, deploy waits on a bot re-render). Cleaner ownership, but it couples every deploy to the bot being up. Lost to the convergent three-writer design above.
- **A hand-rolled Gateway client on Node 22's `WebSocket`.** No dependency, but heartbeat, resume, rate limits and reconnects would be ours. Lost because that complexity is outside the domain.

## Consequences

- Curating is one mention, and the reply arrives once the page is verified (seconds, not up to 80 minutes).
- There is no git history of the list. The audit trail is the Discord channel, the bot's journal, and the signed events themselves.
- `npm run check:curation` compares bodies against this checkout's `vault/essays/`, so Essays the bot curated since the last vault sync report `not-captured` until the follow-up sync exists.
- A Curation the bot cannot read (all relays down, no local copy) blocks curation until relays answer. This is deliberate.
- The droplet now runs Node and a long-lived process. `journalctl -u cinemaslime-bot` is where its failures show up.
