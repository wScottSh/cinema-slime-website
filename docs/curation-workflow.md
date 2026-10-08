# Curating the Official Cinema Slime Essays

The **official Essay collection** is controlled entirely by one Nostr event — the brand's
`kind:30001` curation list. Adding an Essay, renaming its Essay Slug, and naming its
author are all publish-once operations: the Curator bot edits the live list, signs it,
and publishes it. No code change or site deploy required.

---

## How it works

The site fetches the curation list from relays at runtime using a single hardcoded trust
anchor: `BRAND_PUBKEY` in `src/brand.js`. Any `kind:30001` event published by any other
key is ignored.

The list is an addressable (replaceable) event — it lives at one stable coordinate
(`30001:<brand_pubkey>:cinema-slime-essays`) and the site always uses the newest version.
Publishing a new list immediately supersedes the old one.

The live event is the **only** copy of the list (ADR 0021). There is no list in git. The
Curator always edits the newest live version, so nothing can republish a stale copy.

---

## Curation list payload shape

```
kind:    30001
content: ""           (empty — all data is in the tags)
tags:
  ["d", "cinema-slime-essays"]                              ← stable identifier, required
  ["a", "30023:<author_pubkey>:<identifier>", "", "<slug>"] ← one tag per curated Essay
  ["alias", "<old-slug>", "30023:<author_pubkey>:<identifier>"] ← one tag per Slug Alias
  ["p", "<author_pubkey>", "", "Display Name"]              ← one tag per brand-approved name
```

- **`a` tag** — the full NIP-01 addressable coordinate of the Essay, then an empty relay
  hint, then the Essay Slug (ADR 0005). Tag order is display order.
- **`alias` tag** — a Slug Alias (ADR 0022): a slug the Essay used to have, and the
  coordinate it belongs to. `/essay/<old-slug>` unfurls as the Essay and redirects to its
  current slug. Slugs and aliases share one namespace.
- **`p` tag** — the NIP-02 petname format: `[type, pubkey, relay_hint, display_name]`.
  The display name is what the site shows — the brand controls it and it does not have to
  match the author's own Nostr profile.

`src/curation.js` (`curationFromEvent` / `curationToTags`) is the only code that reads or
writes these tags for an edit. It refuses to edit a list with a duplicate coordinate,
a duplicate or malformed slug, or an alias that points at an unlisted Essay or shadows
another slug or alias.

---

## Common operations

Everything happens by @mentioning the **Cinema Slime Curator** bot in #admin-convos.
It reacts with 👀, does the work, and replies once with the Essay's link. The reply says
whether Discord's preview card was verified.

### Add an Essay

```
@Cinema Slime Curator <naddr, or an njump / habla / yakihonne / primal link to it>
```

The bot captures the Essay's signed event, picks an Essay Slug from its title
(`pickSlug` in `src/essay-slug.js`), publishes the Curation, writes the Essay Page, and
checks that the page serves its own Link Preview. Add `slug:the-slug` to choose the slug
yourself.

The standard slug (ADR 0022) is the work plus its number for an episode or a numbered
issue, and the title's own name otherwise:

| Title | Slug |
|---|---|
| The Mirror - Spider-Man Noir S1E8 (Spoilers) | `spider-man-noir-s1e8` |
| Betrayal - S1E5 Spider-Man Noir | `spider-man-noir-s1e5` |
| Bats are CRAZY - Absolute Batman #1 (Spoilers) | `absolute-batman-1` |
| The Empty City - The Cimmerian: Xuthal of the Dusk #1 | `the-cimmerian-1` |
| Feeling Alive 2007: A Daft Punk Odyssey | `feeling-alive-2007` |
| My Own Private Idaho x 1991 | `my-own-private-idaho-1991` |

### Credit a new author

The first Essay by an author the site doesn't credit yet is refused until you name them:

```
@Cinema Slime Curator <link> name:"Display Name"
```

### Rename an Essay Slug

```
@Cinema Slime Curator <link> rename slug:new-slug
```

The old slug becomes a Slug Alias: `/essay/<old-slug>` keeps unfurling as the Essay and
redirects to the new slug. Renaming back to an old slug reclaims it. Mentioning a listed
Essay with a different `slug:` and no `rename` is refused, so an address can't change by
accident.

### Standardize every slug (GitHub Actions, not Discord)

Run the **Curator command** workflow (`.github/workflows/curator-command.yml`) from the
Actions tab:

1. Run it with `standardize --dry-run`. The job log shows `old-slug -> new-slug` for every
   Official Essay. Nothing is published.
2. If the table is right, run it with `standardize`. It publishes the Curation once, with
   every changed slug kept as a Slug Alias, then renders and checks every Essay Page,
   alias pages included.

The workflow stops the bot, runs the command on the droplet, and always starts the bot
again. A second `standardize` reports that every slug is already standard.

### Start a podcast Episode from a Craig recording

```
@Cinema Slime Curator https://craig.horse/rec/<id>?key=<key> [Episode title]
```

The bot passes the recording to the cs-pod-editor on Unicron over the `cspod` WireGuard
tunnel (ADR 0023) and replies once with the Episode's editor link. The editor posts the
upload folders, and later the ready link, in the channel itself. The same link again
answers with the existing Episode. `craig.chat` links work too, and Craig's `delete=` key
is ignored and never sent. Put one link in each mention: a Craig link and an Essay link
together are refused.

### Re-curate a listed Essay

Mentioning a listed Essay again publishes nothing. It re-renders the Essay Pages,
re-verifies the preview, and replies with the link.

### Remove an Essay, or change a display name

Not supported. ADR 0021 left both out until they are needed; adding one is a new
`Command` and a pure edit in `src/curation.js`, wired through the Curator.

---

## Break-glass CLI (on the droplet)

When Discord is down, the operator can run the same Curator over SSH. It refuses while the
daemon holds the Curator lock, so stop the daemon first:

```bash
systemctl stop cinemaslime-bot
cinemaslime-bot curate '<link>' [--slug the-slug] [--name "Display Name"]
cinemaslime-bot rename '<link>' --slug new-slug
cinemaslime-bot standardize [--dry-run]
systemctl start cinemaslime-bot
```

## Craig intake setup (operator)

Intake is optional: without it, a Craig link gets a "not set up" reply and Essays keep
working.

1. `deploy/bot/config.json` holds `intake.url` (`https://10.77.0.2:8790/api/intake`) and
   `intake.certSha256`, the SHA-256 fingerprint of the editor's self-signed certificate.
   Check it from the droplet:

   ```bash
   echo | openssl s_client -connect 10.77.0.2:8790 2>/dev/null | openssl x509 -noout -fingerprint -sha256
   ```

   When the editor's certificate changes, update `certSha256` and redeploy.
2. Set the GitHub Actions secret `CSPOD_INTAKE_SECRET` to the editor's `CSPOD_INTAKE_SECRET`
   (`gh secret set CSPOD_INTAKE_SECRET`), then run the deploy-bot workflow. It writes
   `/etc/cinemaslime-bot/credentials/cspod-intake-secret` (root, 0600), which the unit
   loads with `LoadCredential=`.
3. On start the bot logs `intake: <url>`, or `intake: off (...)` naming what is missing
   (`journalctl -u cinemaslime-bot`).

## What a publish does

Before publishing, the Curator collects every Official Essay's existing signed event
(`SOURCE_RELAYS` in `src/curation-publish.js`: the brand relays plus nos.lol,
relay.primal.net and YakiHonne's relays, read-only) into its vault and pushes each one
verbatim to every brand relay. An Essay found on no relay aborts the publish (its author
must re-publish). The new Curation's `created_at` is always newer than the list it was
edited from, and the bot keeps its last signed copy, so a relay outage never makes it
build a list from nothing.

The bot's vault lives on the droplet (`/var/lib/cinemaslime-bot/vault/essays`). It was
seeded from `vault/essays/` in this repo, which is now a backup that lags the droplet.

## Checking the live state (read-only, no secret key)

```bash
npm run check:curation   # live list found; held by >= 2 brand relays; bodies openable
npm run check:coverage   # per Official Essay: which brand relays hold it; fails if any < 2
```

Both exit non-zero on failure and name what is wrong. `check:curation` compares against
this checkout's `vault/essays/`, so an Essay the bot curated since the last vault sync
reports `not-captured`.

---

## Relationship to the codebase

| Component | Source | Role |
|---|---|---|
| List format (site) | `src/essay-curation.js` | `parseCurationList` defines what the site reads |
| List format (edits) | `src/curation.js` | The Curation domain type and its pure edits |
| Trust anchor | `src/brand.js` | `BRAND_PUBKEY`, `CURATION_LIST_KIND`, `CURATION_LIST_IDENTIFIER` |
| Curator | `bot/` | The Discord bot and break-glass CLI (ADR 0021) |
| Craig intake | `bot/intake.js` | Forwards a Craig link to the cs-pod-editor (ADR 0023) |
| Curator command workflow | `.github/workflows/curator-command.yml` | Runs CLI-only Curator commands (`standardize`) on the droplet (ADR 0022) |
| Publish | `src/curation-publish.js` | Read, sign, presence gate, harvest |
| Brand relay set | `src/brand.js` | `BRAND_RELAYS` — read, publish, and checks (ADR 0017) |
| Live checks | `scripts/check-curation.mjs`, `scripts/check-coverage.mjs` | Read-only audits of the live Curation and per-Essay relay coverage |
| End-to-end test | `scripts/verify-curation.mjs` | Automated gate-check for CI |
