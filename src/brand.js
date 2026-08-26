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

// The single source of truth for "the relays the site reads." Both the site's
// own Essay/Episode fetchers (nostr-pool.js) and EssayVault's read-back
// (essay-vault.js) consume exactly this list, so "confirmed present" can never
// drift from what a visitor's browser actually queries. See #156.
export const READER_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
];
