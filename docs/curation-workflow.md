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
  ["p", "<author_pubkey>", "", "Display Name"]              ← one tag per brand-approved name
```

- **`a` tag** — the full NIP-01 addressable coordinate of the Essay, then an empty relay
  hint, then the Essay Slug (ADR 0005). Tag order is display order.
- **`p` tag** — the NIP-02 petname format: `[type, pubkey, relay_hint, display_name]`.
  The display name is what the site shows — the brand controls it and it does not have to
  match the author's own Nostr profile.

`src/curation.js` (`curationFromEvent` / `curationToTags`) is the only code that reads or
writes these tags for an edit. It refuses to edit a list with a duplicate coordinate,
a duplicate slug, or a malformed slug.

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

### Credit a new author

The first Essay by an author the site doesn't credit yet is refused until you name them:

```
@Cinema Slime Curator <link> name:"Display Name"
```

### Rename an Essay Slug

```
@Cinema Slime Curator <link> rename slug:new-slug
```

The old `/essay/<old-slug>` link stops working; the coordinate link keeps working. Mentioning
a listed Essay with a different `slug:` and no `rename` is refused, so a link can't be
broken by accident.

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
systemctl start cinemaslime-bot
```

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
| Publish | `src/curation-publish.js` | Read, sign, presence gate, harvest |
| Brand relay set | `src/brand.js` | `BRAND_RELAYS` — read, publish, and checks (ADR 0017) |
| Live checks | `scripts/check-curation.mjs`, `scripts/check-coverage.mjs` | Read-only audits of the live Curation and per-Essay relay coverage |
| End-to-end test | `scripts/verify-curation.mjs` | Automated gate-check for CI |
