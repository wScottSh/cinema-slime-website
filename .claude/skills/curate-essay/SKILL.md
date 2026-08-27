---
name: curate-essay
description: Add a Cinema Slime Essay to the curation list from a pasted Nostr long-form post. Extracts the kind:30023 coordinate (from raw event JSON, an naddr, an njump/habla link, or a bare 30023 coordinate), proposes a URL slug for the user to approve, writes the entry into the ESSAYS array in scripts/publish-curation.mjs, and ends with the copyable PowerShell publish command. Use when the user pastes a Nostr long-form post / naddr / essay link and wants to add, curate, or list it as an official Essay.
---

# Curate an Essay

The user gives you a Nostr long-form post. Everything is deterministic except the
**slug** — that's the one thing you propose and they approve. Then you edit
`scripts/publish-curation.mjs` and hand back the publish command.

## Workflow

1. **Extract + capture.** Run the extractor on whatever the user pasted (raw JSON
   event — preferred, `naddr1…`, an njump/habla URL, or a bare `30023:<hex>:<id>`
   coordinate). Before printing anything, it CAPTURES the Essay's original signed
   event into the brand's committed vault (`vault/essays/`, EssayVault — #157/#159):
   raw JSON needs no network; an naddr uses its own embedded relay hints; a bare
   coordinate has no hints of its own and requires `--relays`:

   ```bash
   # piped JSON event (preferred — no relay fetch needed):
   <paste> | node .claude/skills/curate-essay/scripts/extract.mjs
   # or a naddr/URL (relay hints honored automatically):
   node .claude/skills/curate-essay/scripts/extract.mjs '<naddr-or-url>'
   # or a bare coordinate — requires explicit source relays:
   node .claude/skills/curate-essay/scripts/extract.mjs '<coordinate>' --relays wss://relay.damus.io,wss://nos.lol
   # or a saved file:
   node .claude/skills/curate-essay/scripts/extract.mjs --file event.json
   ```

   If capture fails — the bytes can't be obtained from any relay, the signature is
   invalid, the coordinate doesn't match, or the kind isn't 30023 — the extractor
   exits non-zero with a clear reason and prints nothing else. **Stop.** Nothing is
   written to the vault or to `scripts/publish-curation.mjs`; tell the user why and
   ask for the raw JSON (Primal "Copy Raw Data") or working relay hints instead.

   On success it prints `CAPTURED` (the vault copy is already committed to disk —
   remember to include it when you commit the curation entry), then `COORDINATE`,
   `TITLE`, `AUTHOR_IN_NAMES`, `COORDINATE_ALREADY_LISTED`, a `SLUG_SEED`, and the
   `EXISTING_SLUGS` already in use. If it prints `COORDINATE_ALREADY_LISTED: YES`,
   that's fine — a re-capture of an updated Essay is idempotent (newest version
   wins); ask the user whether they meant to change its slug instead of re-adding it.

2. **Propose a slug (the only HITL step).** From `TITLE`, propose a short, memorable
   slug — not the full slugified title. The seed is a fallback; prefer something
   tighter (e.g. title "The Long Goodbye (2025): A Noir Reverie" → `the-long-goodbye`).
   It must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` and not collide with `EXISTING_SLUGS`.
   Present your proposal and **wait for the user to confirm or edit it.**

3. **Write the ESSAYS entry.** Edit `scripts/publish-curation.mjs`: append a new
   object as the last element of the `ESSAYS` array, matching the existing 2-space
   indentation and `{ coordinate, slug }` shape:

   ```js
     {
       coordinate: '<COORDINATE>',
       slug: '<approved-slug>',
     },
   ```

4. **Handle the author name.** If the extractor printed `AUTHOR_IN_NAMES: NO`, the
   author has no display name on the list. Tell the user, and if they give a display
   name, add `{ pubkey: '<AUTHOR_HEX>', name: '<Name>' }` to the `NAMES` array. If
   `AUTHOR_IN_NAMES: yes (<name>)`, nothing to do — leave `NAMES` alone.

5. **End with the publish wizard.** Always finish by surfacing this single line for the
   user to run in their own terminal (use `powershell` instead of `pwsh` if that's what's
   on the box):

   ```
   pwsh C:\Users\Scott\repos\cinema-slime-website\scripts\publish-curation.ps1
   ```

   The wizard prompts for the 64-char brand secret with **hidden input** (never on the
   command line or in shell history — never ask them to paste it into chat), runs
   `npm run publish:curation`, and scrubs the secret on exit. As a single permanent path
   it pastes cleanly into mobile/SSH terminals with no line-break garbling. It should
   print `Accepted by N/<writer relay count> relays` (N ≥ 1) and `✅ Every Official Essay
   body confirmed present. Curation list published.` — the
   writer relay count grows by one once the brand's guarantee relay (#161) is
   provisioned, so don't expect a fixed number.

## Notes

- The extractor reuses the site's own `parseLongFormEvent`, so the coordinate is
  byte-identical to what the site reads back off the relay. See
  [docs/curation-workflow.md](../../../docs/curation-workflow.md) for the domain model.
- This skill only edits the file. To actually broadcast, the user runs the wizard in
  step 5 (the agent never holds the brand secret) — the `publish-curation` skill covers
  the broadcast-and-verify loop if they want hand-holding through it.
