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

// The all-zeros pubkey the live checks treat as "brand not configured yet"
// (fail-closed: nothing is fetched or verified under it).
export const BRAND_PUBKEY_PLACEHOLDER = '0'.repeat(64);

// The relay filter that selects the Curation published by `author` (the brand
// by default) — shared by the publish script's read-back and both live checks.
export function curationListFilter(author = BRAND_PUBKEY) {
  return { kinds: [CURATION_LIST_KIND], authors: [author], '#d': [CURATION_LIST_IDENTIFIER] };
}

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

// THE single brand relay set (#168): the relays the site reads from, the
// relays the Curation (and every captured Official Essay) publishes to, and
// the relays both live checks (check:curation, check:coverage) probe are all
// drawn from this ONE list, so they can never drift apart. Why these four,
// and why one set rather than a read/publish split: see
// docs/decisions/0017-single-brand-relay-set.md.
const BRAND_PUBLIC_RELAYS = ['wss://relay.damus.io', 'wss://relay.nostr.net', 'wss://offchain.pub', 'wss://relay.ditto.pub'];

// The single source of truth for "the relays the brand reads from and
// publishes to" — includes the brand's own guarantee relay (#161) once
// provisioned (see withGuaranteeRelay above), so a visitor's own browser and
// every capture/publish both include the brand-controlled anchor.
export const BRAND_RELAYS = withGuaranteeRelay(BRAND_PUBLIC_RELAYS);

// WRITER_RELAYS and READER_RELAYS are now the SAME set (#168) — kept as two
// named exports only because call sites (scripts/publish-curation.mjs,
// scripts/check-curation.mjs, scripts/capture-idaho-essay.mjs,
// src/nostr-pool.js, src/production-vault.js) read better self-documented as
// "the relays I write to" / "the relays I read from" than as a single
// undifferentiated BRAND_RELAYS at each call site. src/brand.test.js asserts
// they are literally the same array contents, AND that the site reader and
// the publish script's own exports agree with BRAND_RELAYS, so neither
// brand.js itself nor a consumer can drift back apart silently.
export const WRITER_RELAYS = BRAND_RELAYS;
export const READER_RELAYS = BRAND_RELAYS;

// Exported for tests — see src/brand.test.js — so the filtering behavior
// itself is verified independent of GUARANTEE_RELAY's current value.
export const __testables = { withGuaranteeRelay };
