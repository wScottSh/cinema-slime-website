// =============================================================================
// BRAND CONFIG — the single hardcoded trust anchor for official Cinema Slime
// Essays. The site hardcodes EXACTLY this one value; everything else (which
// Essays are official, what author names to show) is discovered at runtime from
// the latest kind:30001 curation list published by this pubkey. See ADR 0003.
//
// This is the real production brand pubkey, set at launch (#34, the "Essays via
// Nostr" PRD, #11). The matching brand secret key is held by the curator and
// never lives in this repo. To change what is official, edit and re-publish the
// curation list (see docs/curation-workflow.md) — no code change or deploy.
// =============================================================================
export const BRAND_PUBKEY = '3fe7d91eb4133567db1ad7abab7ae308ebd9ae2d109601a7257e995035651365';

// The brand's curation list is a NIP-51 addressable list event with a stable
// `d` identifier, so the "latest version" always lives at one coordinate.
export const CURATION_LIST_KIND = 30001;
export const CURATION_LIST_IDENTIFIER = 'cinema-slime-essays';

// The brand-controlled GUARANTEE RELAY (#161) — the durable presence anchor
// behind Guaranteed Presence. Every other relay below is a public relay: free
// to prune, rate-limit, or vanish an Official Essay at any time, so presence
// there is best-effort only. This one relay is different: the brand runs (or
// pays for and administers) it directly, so it is the one place a captured
// Essay is guaranteed to still be mirrored and readable even if every public
// relay has dropped it. It belongs in BOTH WRITER_RELAYS (every capture is
// mirrored there) and READER_RELAYS (verifyPresence/ensurePresence, and the
// site's own reads via nostr-pool.js, all treat it as one of "the relays the
// site reads") — see essay-vault.js.
//
// DECISION (#161): self-host rather than subscribe to a paid relay. The site
// already runs its own VPS with an nginx-fronted deploy pipeline (see
// deploy/), so standing up a relay (e.g. strfry) behind the brand's own
// domain reuses existing DNS/TLS instead of taking on a recurring third-party
// bill or a dependency the brand doesn't administer. This choice only fixes
// the VALUE of the constant below, never the writer/reader-set design — a
// future switch to a paid relay is a one-line constant change. See
// docs/decisions/0015-brand-guarantee-relay.md.
//
// The human-only provisioning steps (installing the relay, DNS, TLS, getting
// the final wss:// URL) are NOT something an agent can do — see the guided
// wizard at scripts/provision-guarantee-relay.ps1. Until that wizard has been
// run and this constant updated with the real URL, this is a placeholder:
// scripts that depend on the guarantee relay specifically (check-curation.mjs)
// detect the placeholder and report it as not-yet-provisioned rather than
// silently treating it as a working anchor.
export const GUARANTEE_RELAY_PLACEHOLDER = 'wss://relay.cinemaslime.example/NOT-YET-PROVISIONED';
export const GUARANTEE_RELAY = GUARANTEE_RELAY_PLACEHOLDER;

// Appends the guarantee relay to a public relay list, UNLESS it is still the
// un-provisioned placeholder. This is deliberate: the placeholder is not a
// real relay — it does not resolve and never sends EOSE — so letting it into
// WRITER_RELAYS/READER_RELAYS before provisioning would make every visitor's
// browser (via nostr-pool.js's DEFAULT_RELAYS) open a doomed WebSocket on
// every fetch, and would make `publish:curation` report a guaranteed-dead
// writer slot. Excluding the placeholder means the un-provisioned state
// behaves exactly like it did before this slice; the moment the wizard
// (scripts/provision-guarantee-relay.ps1) rewrites GUARANTEE_RELAY to a real
// URL, that URL starts appearing in both sets with no further code change.
function withGuaranteeRelay(publicRelays, guaranteeRelay = GUARANTEE_RELAY) {
  if (guaranteeRelay === GUARANTEE_RELAY_PLACEHOLDER) return [...publicRelays];
  // Guard against a provisioned URL that happens to duplicate one already in
  // the public list — the wizard's own validation doesn't check this, so the
  // single source of truth does, keeping "no duplicate entries" true by
  // construction rather than relying on a test to catch it after the fact.
  return publicRelays.includes(guaranteeRelay) ? [...publicRelays] : [...publicRelays, guaranteeRelay];
}

// The public, best-effort relays the brand broadcasts to. Historically this
// list also fed the reader set directly (see READER_RELAYS below for why that
// changed under #167).
//
// DECISION (#167): kept as-is. The relay-selection research (posted inline on
// #167, since the notes-folder note it referenced never landed) recommends
// publishing to all 10 ranked relays and demoting nos.lol to publish-only
// (flaky reads: 2 of 5 connection attempts timed out, 1 returned 502), but
// unifying the reader and writer sets into that one wider brand relay set is
// #168's job, and re-broadcasting Official Essays and the Curation to it is
// #170's job — both explicitly separate from #167. Changing only the READ set
// here fixes #167's bug (cold visitors seeing stale Essays) without either of
// those broader, curator-approval-needing changes.
//
// KNOWN TEMPORARY DRIFT: until #168 lands, this writer set and READER_RELAYS
// below now share only relay.damus.io. A Curation republished before then
// reaches the read set only via that one shared relay — expected, not a bug.
const PUBLIC_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

// The public, best-effort writer set — where an Official Essay's original
// signed event is mirrored on capture/publish (see #157's ensurePresence and
// #158's publish gate) — plus the brand's own guarantee relay, once
// provisioned (see withGuaranteeRelay above). Single source of truth:
// scripts/publish-curation.mjs and every one-off capture script import this
// instead of hardcoding their own relay list.
export const WRITER_RELAYS = withGuaranteeRelay(PUBLIC_RELAYS);

// The single source of truth for "the relays the site reads." Both the site's
// own Essay/Episode fetchers (nostr-pool.js) and EssayVault's read-back
// (essay-vault.js) consume exactly this list, so "confirmed present" can never
// drift from what a visitor's browser actually queries. See #156. Includes
// the guarantee relay (#161) once provisioned, so a visitor's own browser is
// one of the places that can open an Official Essay directly from the
// brand-controlled anchor.
//
// DECISION (#167): relay.nostr.band was dropped — it is dead (never answers,
// confirmed unreachable on 2026-09-25) and was the read set's only source for
// older Official Essays, so its outage alone blanked most of the Curation.
// This list is no longer derived from PUBLIC_RELAYS: it follows the "Browser
// read set" from the brand relay selection research posted inline on #167
// (2026-09-25, in lieu of the un-landed notes-folder note the issue
// referenced) — relay.damus.io, relay.nostr.net, offchain.pub, relay.ditto.pub
// — chosen for verified live coverage of the 13 Official Essays (damus holds
// the 4 newest; nostr.net and offchain.pub each hold 8/13; ditto.pub adds a
// 4th pick running different relay software) and dropped relay.primal.net
// (1/13) and nos.lol (best coverage today at 12/13, but flaky reads — 2 of 5
// connection attempts timed out, 1 returned 502 — so the research demotes it
// to publish-only; see PUBLIC_RELAYS above). No live read relay holds all 13
// Essays yet; full coverage needs the re-broadcast tracked in #170. See
// ADR 0016 for the completeness-gated settle this read set now benefits from.
export const READER_RELAYS = withGuaranteeRelay([
  'wss://relay.damus.io',
  'wss://relay.nostr.net',
  'wss://offchain.pub',
  'wss://relay.ditto.pub',
]);

// Exported for tests — see src/brand.test.js — so the filtering behavior
// itself is verified independent of GUARANTEE_RELAY's current value.
export const __testables = { withGuaranteeRelay };
