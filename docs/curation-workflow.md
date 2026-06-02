# Curating the Official Cinema Slime Essays

The **official Essay collection** is controlled entirely by one Nostr event — the brand's
`kind:30001` curation list. Adding or removing an Essay, and controlling the display name
shown for its author, is a publish-once operation: edit the list, sign it, publish it. No
code change or site deploy required.

---

## How it works

The site fetches the curation list from relays at runtime using a single hardcoded trust
anchor: `BRAND_PUBKEY` in `src/brand.js`. Any `kind:30001` event published by any other
key is ignored.

The list is an addressable (replaceable) event — it lives at one stable coordinate
(`30001:<brand_pubkey>:cinema-slime-essays`) and the site always uses the newest version.
Publishing a new list immediately supersedes the old one.

---

## Curation list payload shape

```
kind:    30001
content: ""           (empty — all data is in the tags)
tags:
  ["d", "cinema-slime-essays"]                  ← stable identifier, required
  ["a", "30023:<author_pubkey>:<identifier>"]   ← one tag per curated Essay
  ["p", "<author_pubkey>", "", "Display Name"]  ← one tag per brand-approved name
```

- **`a` tag** — the full NIP-01 addressable coordinate of the Essay. The `d` identifier
  is whatever the author set in their `kind:30023` event.
- **`p` tag** — the NIP-02 petname format: `[type, pubkey, relay_hint, display_name]`.
  The relay hint is left empty (`""`). The display name is what the site shows — the brand
  controls it and it does not have to match the author's own Nostr profile.

The coordinate format is: `30023:<hex_pubkey>:<d_identifier>`.

Example list with two Essays by two authors:

```json
{
  "kind": 30001,
  "content": "",
  "tags": [
    ["d", "cinema-slime-essays"],
    ["a", "30023:fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52:a-cinema-slime-essay"],
    ["a", "30023:c15c4fa606c45c4df23ba8f5df6040e9ccbba82cb7de8d63e5ed1bb4ff25c36f:another-essay"],
    ["p", "fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52", "", "Harrison Jensen"],
    ["p", "c15c4fa606c45c4df23ba8f5df6040e9ccbba82cb7de8d63e5ed1bb4ff25c36f", "", "Renn Jensen"]
  ]
}
```

---

## Common operations

### Add an Essay

1. Find the Essay's coordinate. From a Nostr client or relay explorer, look up the
   `kind:30023` event; the coordinate is `30023:<author_pubkey>:<d_tag_value>`.
2. Open `scripts/publish-curation.mjs` and add one line to the `ESSAYS` array:
   ```js
   '30023:<author_pubkey>:<identifier>',
   ```
3. If you also want to set (or update) the author's display name, add a line to the
   `NAMES` array:
   ```js
   { pubkey: '<author_pubkey>', name: 'Display Name' },
   ```
4. Run the script (see [Running the script](#running-the-script)).

### Remove an Essay

Delete the corresponding `'30023:…'` line from the `ESSAYS` array and re-publish. The
site will stop showing the Essay as official immediately.

Removing an Essay does **not** require removing the author's `p` tag. If the author has
other Essays still on the list, keep the `p` tag; remove it only if the author has no
curated Essays left.

### Change a display name

Edit the `name` field for the relevant entry in the `NAMES` array and re-publish.
The new name takes effect on the next page load — no deploy needed.

### Remove a display name (show no byline)

Delete the `{ pubkey: '…', name: '…' }` line from `NAMES` and re-publish. The Essay
stays official but the site shows no author byline.

---

## Onboarding a new guest or host

1. **Get their Nostr pubkey.** Ask them for their npub or hex pubkey. Most Nostr clients
   display both. Convert npub to hex if needed (e.g. using `nip19.decode` from `nostr-tools`
   or any online converter).
2. **Confirm the Essay exists.** Ask them to share the Essay's `kind:30023` coordinate
   or a deep-link from a Nostr client. The coordinate is
   `30023:<their_pubkey>:<d_identifier>`.
3. **Add their Essay and name** to `scripts/publish-curation.mjs` as described above.
4. **Publish the updated list.** The Essay appears on the site immediately.

No account on any centralised platform is required — only a Nostr identity.

---

## Running the script

```bash
# Test mode — uses a disposable ephemeral key; safe to run anytime
node scripts/publish-curation.mjs

# Production — uses the real brand key; publishes to all configured relays
BRAND_SECRET_KEY=<64-char-hex-secret-key> node scripts/publish-curation.mjs
```

The script prints a confirmation of how many relays accepted the event and reads the
list back to verify the coordinate count. If zero relays accepted it, it exits non-zero.

In test mode the script prints the disposable pubkey and a browser deep-link that lets
you verify the end-to-end flow without touching the production key.

---

## Relationship to the codebase

The script and documentation stay consistent with the parser from issue #29:

| Component | Source | Role |
|---|---|---|
| List format | `src/essay-curation.js` | `parseCurationList` defines what the site reads |
| Trust anchor | `src/brand.js` | `BRAND_PUBKEY`, `CURATION_LIST_KIND`, `CURATION_LIST_IDENTIFIER` |
| Example script | `scripts/publish-curation.mjs` | Curator's publish workflow |
| End-to-end test | `scripts/verify-curation.mjs` | Automated gate-check for CI |

The site is **fail-closed**: until `BRAND_PUBKEY` in `src/brand.js` is set to the real
brand key (deferred to a later slice), no Essay is official and the curation list is
not fetched.
