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

1. **Surface the command.** Show the user this and tell them to run it in their own
   terminal, replacing `<brand-hex-secret>` with the brand's 64-char hex secret key:

   ```powershell
   $env:BRAND_SECRET_KEY="<brand-hex-secret>"; npm run publish:curation; Remove-Item Env:\BRAND_SECRET_KEY
   ```

   Briefly note: it should print `Accepted by N/3 relays` (N ≥ 1) and `✅ List verified`,
   and the trailing `Remove-Item` wipes the secret from their shell. Never ask them to
   paste the secret into the chat.

2. **Wait for the user to confirm they ran it.**

3. **Verify automatically (agent runs this — no secret needed):**

   ```
   npm run check:curation
   ```

   It reads the live list off the relays and compares it to the local `ESSAYS`/`NAMES`.
   Report the result:
   - `✅ LIVE LIST MATCHES` → broadcast confirmed, done.
   - Mismatch or no list found → relays may still be indexing; wait ~10s and re-run once.
     If it still fails, the wrong secret may have been used (list published under the wrong
     pubkey) — check the publish output's `Pubkey:` against `BRAND_PUBKEY` in `src/brand.js`.

## Notes

- Running `npm run publish:curation` with no `BRAND_SECRET_KEY` is a safe dry run (disposable
  key, does not touch the real list).
- This skill only broadcasts. To change *what* is official, edit `ESSAYS`/`NAMES` first —
  see [docs/curation-workflow.md](../../../docs/curation-workflow.md).
