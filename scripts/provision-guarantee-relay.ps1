#!/usr/bin/env pwsh
# Guided wizard for the HUMAN-ONLY steps behind the brand's guarantee relay
# (#161, part of spec #156 — Guaranteed Presence).
#
# What this is: every Official Essay is already mirrored to public relays
# (see docs/curation-workflow.md) and to the brand's own committed vault (#157,
# #159). What's still missing is a relay the BRAND ITSELF controls, so an
# Essay stays openable even if every public relay drops it. Decision record:
# docs/decisions/0015-brand-guarantee-relay.md — self-host (e.g. strfry) on
# infrastructure the brand already operates, behind the brand's own domain.
#
# This script does NOT provision anything for you — an agent cannot SSH into
# your VPS, buy a subscription, or click through a relay host's dashboard.
# It walks you through the decisions and steps in order, then (once you have
# a real wss:// URL) writes it into src/brand.js's GUARANTEE_RELAY constant,
# mirrors every Official Essay onto it, and confirms the guarantee actually
# holds.
#
# Run:
#     pwsh C:\Users\Scott\repos\cinema-slime-website\scripts\provision-guarantee-relay.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$brandFile = Join-Path $repoRoot 'src\brand.js'
$placeholder = 'wss://relay.cinemaslime.example/NOT-YET-PROVISIONED'

function Step($n, $title) {
    Write-Host ""
    Write-Host "── Step $n. $title ──" -ForegroundColor Cyan
}

Write-Host "Brand Guarantee Relay — provisioning wizard (#161)" -ForegroundColor Green
Write-Host "This only covers steps a human must do. Nothing here is automated for you."

Step 1 'Confirm self-host vs. paid relay'
Write-Host "Decision on record (docs/decisions/0015-brand-guarantee-relay.md): SELF-HOST."
Write-Host "If you'd rather use a paid relay instead, that's a valid alternative — skip the"
Write-Host "self-host specifics in Steps 2-3 (install with your provider's own onboarding),"
Write-Host "then come back here for Step 4 onward with the URL they give you. Either way,"
Write-Host "the constant and the rest of this wizard are unchanged."
Read-Host "Press Enter to continue"

Step 2 'Provision the relay software (self-host path)'
Write-Host "On a host you control (the existing site VPS is a natural choice — see deploy/):"
Write-Host "  1. Install a Nostr relay implementation, e.g. strfry (https://github.com/hoytech/strfry)."
Write-Host "  2. Run it as a long-lived service (systemd unit) bound to localhost."
Write-Host "  3. Configure it to accept writes at least from the brand's own pubkey/IP,"
Write-Host "     and to serve public reads (the site's visitors need to read from it too)."
Read-Host "Press Enter once the relay process is installed and running"

Step 3 'DNS + TLS (self-host path)'
Write-Host "  1. Point a subdomain (e.g. relay.<your-domain>) at the VPS."
Write-Host "  2. Reverse-proxy wss:// traffic through nginx to the relay's local port,"
Write-Host "     reusing the site's existing TLS certificate flow (see deploy/nginx)."
Write-Host '  3. Confirm from OUTSIDE the VPS that the relay upgrades and responds, e.g.:'
Write-Host '       wscat -c wss://relay.<your-domain>'
Read-Host "Press Enter once the relay is reachable over wss:// from the public internet"

Step 4 'Enter the final relay URL'
$url = Read-Host "Paste the confirmed wss:// URL for the guarantee relay"
if ($url -notmatch '^wss://\S+$') {
    Write-Error "Expected a wss://... URL. Aborting without changing src/brand.js."
    exit 1
}
if ($url -eq $placeholder) {
    Write-Error "That's the documented placeholder, not a real relay. Aborting without changing src/brand.js."
    exit 1
}

Step 5 'Update src/brand.js'
$content = Get-Content -Raw -LiteralPath $brandFile
$pattern = "export const GUARANTEE_RELAY = GUARANTEE_RELAY_PLACEHOLDER;"
if ($content -notmatch [regex]::Escape($pattern)) {
    Write-Host "GUARANTEE_RELAY already appears to be set to something other than the"
    Write-Host "placeholder. Edit src/brand.js by hand if you need to change it, then re-run"
    Write-Host "from Step 6. Skipping the automatic edit."
} else {
    $updated = $content.Replace($pattern, "export const GUARANTEE_RELAY = '$url';")
    Set-Content -LiteralPath $brandFile -Value $updated -NoNewline -Encoding utf8
    Write-Host "Updated GUARANTEE_RELAY in src/brand.js -> $url" -ForegroundColor Green
    Write-Host "(WRITER_RELAYS/READER_RELAYS now include it automatically — see brand.js.)"
}

Step 6 'Mirror every Official Essay onto the guarantee relay'
Write-Host "The relay is provisioned but empty: nothing has been mirrored to it yet, so the"
Write-Host "audit in Step 7 would fail. Run the publish workflow now — it re-mirrors every"
Write-Host "Official Essay's captured body to the full writer set (now including the"
Write-Host "guarantee relay you just added) before it re-broadcasts the curation list."
Write-Host "This needs the brand secret key (hidden input, never logged)."
Push-Location $repoRoot
try {
    pwsh (Join-Path $repoRoot 'scripts\publish-curation.ps1')
} finally {
    Pop-Location
}

Step 7 'Confirm the guarantee'
Write-Host "Running the presence audit — this confirms every Official Essay is mirrored"
Write-Host "to, and specifically readable from, the guarantee relay you just provisioned."
Push-Location $repoRoot
try {
    npm run check:curation
} finally {
    Pop-Location
}
