# One brand relay set for reading, publishing, and checking

**Date**: 2026-09-25
**Status**: accepted
**Amends**: ADR 0002 §2 (default relay set); resolves ADR 0014's open question
**Context**: #165 found the Discovery View showing 4 of 13 Official Essays. Part of the cause was the relay lists themselves: the site read from one list and the Curation publish script wrote to another, and nothing checked either against where the Essays actually lived. #167 changed the read set; #168 unified the lists; #169 added the per-Essay coverage check.

---

## Context / problem

Before #167/#168 there were two relay lists in `src/brand.js`:

- **Readers** (the site, `EssayVault` read-back): `relay.damus.io`, `nos.lol`, `relay.primal.net`, `relay.nostr.band`.
- **Writers** (Curation publish, Essay mirroring): `relay.damus.io`, `nos.lol`, `relay.primal.net`.

By September 2026 `relay.nostr.band` was dead, `nos.lol` failed 3 of 5 WebSocket upgrades in the #167 research (two timeouts, one 502), `relay.primal.net` held 1 of 13 Official Essays, and `relay.damus.io` held only the 4 newest. The lists had already drifted: during the July outage the Curation resolved from exactly one relay (ADR 0014).

## Decision

`src/brand.js` exports **one** brand relay set, `BRAND_RELAYS`. It feeds:

- the site's reads (`nostr-pool.js` `DEFAULT_RELAYS`, `production-vault.js`);
- the Curation publish script and Essay mirroring (`WRITER_RELAYS`);
- both live checks: `npm run check:curation` and `npm run check:coverage`.

`WRITER_RELAYS` and `READER_RELAYS` still exist as named aliases of the same list so call sites stay readable. `src/brand.test.js` asserts that the aliases, the site reader, and the publish script all equal `BRAND_RELAYS`.

**Contents:** `wss://relay.damus.io`, `wss://relay.nostr.net`, `wss://offchain.pub`, `wss://relay.ditto.pub`, plus the brand guarantee relay once provisioned (ADR 0015). This is the "browser read set" from the #167 relay research, which is inlined in the comments on #167:

- `relay.nostr.net` and `offchain.pub` each held 8/13 Official Essays.
- `relay.damus.io` is the fastest relay and holds the latest Curation.
- `relay.ditto.pub` runs different relay software, which adds diversity.

**Dropped:**

- `relay.nostr.band`: dead.
- `relay.primal.net`: 1/13 Essays, and it keeps no long-form older than about 7.5 months.
- `nos.lol`: flaky reads.

**Coverage is a checked fact.** Both checks apply one rule (`src/relay-coverage.js`): the Curation, and each Official Essay, must be held by at least `MIN_RELAY_COVERAGE` (2) brand relays individually, or the check exits non-zero. This replaces ADR 0007's assumption that events are "published to all relays".

## Alternatives considered

- **The research's read/publish split.** Read from these 4 and publish to 10 ranked relays, including `nos.lol` as publish-only because it held 12/13. Not adopted here. #168 requires the Curation to publish to *exactly* the relays the site reads from, with a single set a test can pin. Publishing more widely is still an option. If adopted, it would be a separate, curator-approved change that adds a publish-only superset alongside `BRAND_RELAYS`. The checks would keep auditing the read set, since that is what visitors see.
- **Keep two lists and only fix their contents.** Rejected. That is how they drifted in the first place.

## Consequences

- The read set, the publish set, and the checks can no longer drift apart. Widening the set is a one-line change in `src/brand.js`, plus the hand-copied public list in `public/llms.txt` (pinned by `src/brand.test.js`).
- The **live** Curation and Essay events were published under the old writer set. Until they are re-broadcast to this set (#170, human-only), `check:curation` and `check:coverage` are expected to fail. That failure is intended: it shows exactly what needs to be re-broadcast.
- Since `nos.lol` is out of the set, new captures are no longer mirrored to the relay that held the most Official Essays. Coverage now depends on #170 plus the checks, not on one well-stocked relay.
- `scripts/verify-curation.mjs` deliberately keeps its own hardcoded public-relay list. It publishes throwaway test events under an ephemeral key, and those events have no business on the brand's guarantee relay.
