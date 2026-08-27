# Brand Guarantee Relay: Self-Host vs. Paid — Self-Host

**Date**: 2026-08-26
**Status**: accepted
**Context**: #161, part of spec #156 (Guaranteed Presence)

## Context / problem

Guaranteed Presence (#156–#160) makes every Official Essay's body durable by
holding the brand's own copy and mirroring it to the relays the site reads.
But every relay in `READER_RELAYS`/`WRITER_RELAYS` up to this point is a
public, third-party relay — free to prune, rate-limit, or vanish an event at
any time. "Currently on public relays" is not "permanently guaranteed": the
guarantee needs one relay the brand actually controls, so an Official Essay
stays openable even if every public relay drops it.

The open question this slice had to settle: should that anchor be
self-hosted, or a paid relay subscription the brand controls (e.g. a hosted
relay-as-a-service product)? Either way the design is identical — one more
URL in the writer set (so captures get mirrored there) and the reader set (so
verifyPresence/ensurePresence and the site's own reads treat it as one of the
relays "the site reads") — so this decision only fixes the constant's VALUE.

## Decision

**Self-host.** The brand relay runs as a self-administered process (e.g.
`strfry`) on infrastructure the brand already operates, fronted by the
brand's own domain, DNS, and TLS.

## Rationale

- The site already runs its own VPS with an nginx-fronted static deploy
  pipeline (see `deploy/`) and existing DNS/TLS for the production domain.
  Standing up a relay there reuses infrastructure and credentials the brand
  already administers, rather than introducing a new third-party account.
- No recurring subscription cost or vendor dependency for a guarantee the
  brand is explicitly trying to make independent of anyone else's continued
  cooperation — the whole point of this slice is to stop depending on public
  relays' goodwill.
- Full operational control: the brand can size storage, retention, and access
  policy for exactly the writer/reader traffic this relay needs to serve
  (the brand's own events, plus read-back), without a third party's terms of
  service or outage schedule sitting between the brand and its own guarantee.
- The switch to a paid relay later, if self-hosting ever becomes a burden,
  is a one-line change to `GUARANTEE_RELAY` in `src/brand.js` — nothing else
  in the writer/reader-set design needs to move.

## Consequences

- The human-only provisioning steps (installing the relay software,
  DNS record, TLS certificate, obtaining the final `wss://` URL) are captured
  as a runnable wizard: `scripts/provision-guarantee-relay.ps1`. An agent
  cannot perform these steps; the wizard exists to walk a human through them
  and, once a URL is entered, update the constant for them.
- Until the wizard has been run, `GUARANTEE_RELAY` in `src/brand.js` remains
  the placeholder value `GUARANTEE_RELAY_PLACEHOLDER`. That placeholder does
  not resolve and is deliberately EXCLUDED from `WRITER_RELAYS`/`READER_RELAYS`
  (see `withGuaranteeRelay` in `src/brand.js`) — otherwise every visitor's
  browser (via `nostr-pool.js`'s `DEFAULT_RELAYS`) would open a doomed
  WebSocket on every fetch, and `publish:curation` would report a
  guaranteed-dead writer slot. `scripts/check-curation.mjs` separately
  detects the placeholder and reports the guarantee-relay-specific check as
  not-yet-provisioned rather than silently treating it as a working anchor.
- Operational burden (uptime, backups, security patching) for the relay now
  sits with the brand rather than a vendor. This is accepted as the intended
  trade-off for the independence gained.
