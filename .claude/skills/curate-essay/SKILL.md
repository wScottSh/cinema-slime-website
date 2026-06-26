---
name: curate-essay
description: Add a Cinema Slime Essay to the curation list from a pasted Nostr long-form post. Extracts the kind:30023 coordinate (from raw event JSON, an naddr, an njump/habla link, or a bare 30023 coordinate), proposes a URL slug for the user to approve, writes the entry into the ESSAYS array in scripts/publish-curation.mjs, and ends with the copyable PowerShell publish command. Use when the user pastes a Nostr long-form post / naddr / essay link and wants to add, curate, or list it as an official Essay.
---

# Curate an Essay

The user gives you a Nostr long-form post. Everything is deterministic except the
**slug** — that's the one thing you propose and they approve. Then you edit
`scripts/publish-curation.mjs` and hand back the publish command.

## Workflow

1. **Extract.** Run the extractor on whatever the user pasted (raw JSON event,
   `naddr1…`, an njump/habla URL, or a bare `30023:<hex>:<id>` coordinate):

   ```bash
   # piped JSON event:
   <paste> | node .claude/skills/curate-essay/scripts/extract.mjs
   # or a token argument:
   node .claude/skills/curate-essay/scripts/extract.mjs '<naddr-or-url-or-coordinate>'
   # or a saved file:
   node .claude/skills/curate-essay/scripts/extract.mjs --file event.json
   ```

   It prints `COORDINATE`, `TITLE`, `AUTHOR_IN_NAMES`, `COORDINATE_ALREADY_LISTED`,
   a `SLUG_SEED`, and the `EXISTING_SLUGS` already in use. If it prints
   `COORDINATE_ALREADY_LISTED: YES`, stop — the Essay is already curated; ask the
   user whether they meant to change its slug instead.

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

5. **End with the publish command.** Always finish by surfacing this for the user to
   run in their own terminal (replace `<brand-hex-secret>` with the 64-char brand
   secret key — never ask them to paste it into chat):

   ```powershell
   $env:BRAND_SECRET_KEY="<brand-hex-secret>"; npm run publish:curation; Remove-Item Env:\BRAND_SECRET_KEY
   ```

   Note that it should print `Accepted by N/3 relays` (N ≥ 1) and `✅ List verified`;
   the trailing `Remove-Item` wipes the secret from their shell.

## Notes

- The extractor reuses the site's own `parseLongFormEvent`, so the coordinate is
  byte-identical to what the site reads back off the relay. See
  [docs/curation-workflow.md](../../../docs/curation-workflow.md) for the domain model.
- This skill only edits the file. To actually broadcast, the user runs the command in
  step 5 (the agent never holds the brand secret) — the `publish-curation` skill covers
  the broadcast-and-verify loop if they want hand-holding through it.
