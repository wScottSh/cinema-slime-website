// =============================================================================
// BRAND CONFIG — the single hardcoded trust anchor for official Cinema Slime
// Essays. The site hardcodes EXACTLY this one value; everything else (which
// Essays are official, what author names to show) is discovered at runtime from
// the latest kind:30001 curation list published by this pubkey. See ADR 0003.
//
//   ⚠️  PLACEHOLDER PUBKEY  ⚠️
//   The all-zeros value below is an inert placeholder: it matches no events, so
//   until the real key is set the site is fail-closed (no Essay is official).
//   The real production brand pubkey is set later in #G (the "Essays via Nostr"
//   PRD, #11) — replacing this one line is the only change required to point the
//   site at the real brand. The end-to-end flow is verified separately, against
//   a throwaway list under a disposable key, via `npm run verify:curation`.
// =============================================================================
export const BRAND_PUBKEY = '0000000000000000000000000000000000000000000000000000000000000000';

// The brand's curation list is a NIP-51 addressable list event with a stable
// `d` identifier, so the "latest version" always lives at one coordinate.
export const CURATION_LIST_KIND = 30001;
export const CURATION_LIST_IDENTIFIER = 'cinema-slime-essays';
