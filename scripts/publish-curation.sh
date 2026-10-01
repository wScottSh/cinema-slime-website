#!/usr/bin/env bash
# Publish the Cinema Slime Essay curation list (kind:30001) to the Nostr relays.
#
# Bash twin of scripts/publish-curation.ps1 — same publish-and-verify step, for
# Linux/macOS boxes. Run it after the ESSAYS/NAMES edits in
# scripts/publish-curation.mjs are done:
#
#     bash /home/wscottsh/repos/cinema-slime-website/scripts/publish-curation.sh
#
# It prompts for the 64-char brand hex secret with hidden input (never on the
# command line, never in shell history), runs `npm run publish:curation` with
# the secret set for that one process only, and clears it on the way out — even
# on error/Ctrl-C. See publish-curation.ps1 for what publish:curation does.
# Then it runs the two read-only checks — check:coverage (every Essay on >= 2
# brand relays) and check:curation — so the run ends with the per-relay truth.
# Harvested Essays land in vault/essays/; commit them.

set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

key_hex=''
trap 'key_hex=' EXIT

read -rsp 'Brand hex secret key (64 chars, input hidden): ' key_hex
echo
key_hex="${key_hex//[[:space:]]/}"

if [[ ! "$key_hex" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo 'Expected a 64-character hex string. Aborting.' >&2
  exit 1
fi

cd "$repo_root" || exit 1

# Passed as a one-command env prefix, never exported into this shell.
BRAND_SECRET_KEY="$key_hex" npm run publish:curation
publish_exit=$?
key_hex=''

# Read-only verification; needs no secret, so it runs after the scrub.
printf '\n--- Verifying: every Official Essay on >= 2 brand relays ---\n'
npm run check:coverage
coverage_exit=$?
printf '\n--- Verifying: the Curation on the brand relays ---\n'
npm run check:curation
curation_exit=$?

if (( publish_exit != 0 || coverage_exit != 0 || curation_exit != 0 )); then
  printf '\nNOT fully pushed (publish exit %s, check:coverage exit %s, check:curation exit %s). See above.\n' \
    "$publish_exit" "$coverage_exit" "$curation_exit"
  exit 1
fi
printf '\nDone: every Official Essay and the Curation is on the brand relays.\n'
