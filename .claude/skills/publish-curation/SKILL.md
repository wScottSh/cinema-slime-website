---
name: publish-curation
description: Surfaces the command to re-publish the Cinema Slime official Essay curation list (kind:30001) to the Nostr relays, then verifies the broadcast landed. Use when the ESSAYS/NAMES edits in scripts/publish-curation.mjs are already done and the user wants to broadcast, publish, ship, or re-publish the curation list to make the Essay changes live.
---

# Publish the curation list

Assumes the `ESSAYS`/`NAMES` edits in `scripts/publish-curation.mjs` are **already done**.
This re-broadcasts that list as a new `kind:30001` event; the latest event wins, so it
goes live immediately with no site deploy.

The agent does **not** run the publish — the brand secret key must never enter the agent's
context. The agent surfaces the command, then runs the read-only verification afterward.

## Steps

1. **Surface the publish wizard.** Show the user this single line and tell them to run
   it in their own terminal (use `powershell` instead of `pwsh` if that's what's on the
   box):

   ```
   pwsh C:\Users\Scott\repos\cinema-slime-website\scripts\publish-curation.ps1
   ```

   The wizard prompts for the 64-char brand hex secret with **hidden input** (never on
   the command line, never in shell history), runs `npm run publish:curation`, and scrubs
   `BRAND_SECRET_KEY` on exit even on error/Ctrl-C. It's a single permanent path, so it
   pastes cleanly into mobile/SSH terminals with no line-break garbling. Briefly note: it
   should print `Accepted by N/<writer relay count> relays` (N ≥ 1) and `✅ Every Official
   Essay body confirmed present. Curation list published.`
   — the writer relay count grows by one once the brand's guarantee relay (#161) is
   provisioned, so don't expect a fixed number. Never ask the user to paste the secret
   into the chat.

   > Raw fallback (only if the wizard path is unavailable), replacing `<brand-hex-secret>`
   > with the 64-char hex secret:
   >
   > ```powershell
   > $env:BRAND_SECRET_KEY="<brand-hex-secret>"; npm run publish:curation; Remove-Item Env:\BRAND_SECRET_KEY
   > ```

2. **Wait for the user to confirm they ran it.**

3. **Verify automatically (agent runs this — no secret needed):**

   ```
   npm run check:curation
   ```

   It reads the live list off the relays, compares it to the local `ESSAYS`/`NAMES`, and
   separately audits (#160/#161) whether every Official Essay body is actually openable —
   from the reader relays overall, and from the brand's guarantee relay specifically. Report
   the result:
   - `✅ CURATION AUDIT PASS` → broadcast confirmed and every Essay is openable, done.
   - `❌ CURATION AUDIT FAIL` → read the printed detail before reacting:
     - `❌ MISMATCH` on the pointer list → relays may still be indexing; wait ~10s and re-run
       once. If it still fails, the wrong secret may have been used (list published under the
       wrong pubkey) — check the publish output's `Pubkey:` against `BRAND_PUBKEY` in
       `src/brand.js`.
     - `❌ Curation held by N/M brand relays (need >= 2)` → the published list reached too few
       brand relays individually (a single point of failure, ADR 0014). If it just published,
       re-run once after ~10s; if still under 2, the publish mostly failed to land — report
       which relays show ❌ and suggest re-running the publish.
     - `❌ ... Official Essay(s) unavailable` → a captured Essay isn't reading back from the
       reader relays; this is a real Guaranteed Presence gap, not a timing issue.
     - `❌ GUARANTEE_RELAY ... still the placeholder` → expected until the brand's guarantee
       relay has been provisioned (see `scripts/provision-guarantee-relay.ps1`); this failure
       is known and does not mean the publish itself failed.

4. **Check per-Essay relay coverage (agent runs this — read-only, no secret needed):**

   ```
   npm run check:coverage
   ```

   For each Official Essay on the live Curation it prints the Essay Slug, coordinate, and
   which brand relays hold it, and fails if any Essay is held by fewer than 2. A failure
   is not a publish failure — publishing the Curation never moves Essay bodies. Report the
   named Essays as needing a re-broadcast of their signed events (or, if held by 0 relays,
   a re-publish by their author).

## Notes

- Running `npm run publish:curation` with no `BRAND_SECRET_KEY` is a safe dry run (disposable
  key, does not touch the real list).
- This skill only broadcasts. To change *what* is official, edit `ESSAYS`/`NAMES` first —
  see [docs/curation-workflow.md](../../../docs/curation-workflow.md).
