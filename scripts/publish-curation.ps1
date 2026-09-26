#!/usr/bin/env pwsh
# Publish the Cinema Slime Essay curation list (kind:30001) to the Nostr relays.
#
# Permanent, paste-one-line entry point for the publish-and-verify step — the one
# thing that needs the brand secret. Run it after the ESSAYS/NAMES edits in
# scripts/publish-curation.mjs are done:
#
#     pwsh C:\Users\Scott\repos\cinema-slime-website\scripts\publish-curation.ps1
#
# It prompts for the 64-char brand hex secret with hidden input (never on the
# command line, never in shell history), runs `npm run publish:curation`, and
# scrubs the secret from the environment on the way out — even on error/Ctrl-C.
#
# publish:curation pushes to ALL brand relays (src/brand.js BRAND_RELAYS):
#   1. collects every Official Essay's existing signed event (brand relays plus
#      nos.lol / primal / YakiHonne) and names any found nowhere — its author must re-publish;
#   2. pushes each Essay verbatim (never re-signed) to every brand relay and
#      confirms it reads back;
#   3. publishes the Curation to every brand relay, listing each relay's result.
#      If step 2 finds a missing Essay the new Curation is NOT published; the
#      live one is re-sent unchanged to every brand relay instead.
# Then it runs the two read-only checks — check:coverage (every Essay on >= 2
# brand relays) and check:curation — so the run ends with the per-relay truth.
# Harvested Essays land in vault/essays/; commit them.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$secure = Read-Host -AsSecureString 'Brand hex secret key (64 chars, input hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $keyHex = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ($keyHex -notmatch '^[0-9a-fA-F]{64}$') {
    Write-Error 'Expected a 64-character hex string. Aborting.'
    exit 1
}

Push-Location $repoRoot
try {
    try {
        $env:BRAND_SECRET_KEY = $keyHex
        npm run publish:curation
        $publishExit = $LASTEXITCODE
    } finally {
        Remove-Item Env:\BRAND_SECRET_KEY -ErrorAction SilentlyContinue
        $keyHex = $null
        [GC]::Collect()
    }

    # Read-only verification; needs no secret, so it runs after the scrub.
    Write-Host "`n--- Verifying: every Official Essay on >= 2 brand relays ---"
    npm run check:coverage
    $coverageExit = $LASTEXITCODE
    Write-Host "`n--- Verifying: the Curation on the brand relays ---"
    npm run check:curation
    $curationExit = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($publishExit -ne 0 -or $coverageExit -ne 0 -or $curationExit -ne 0) {
    Write-Host "`nNOT fully pushed (publish exit $publishExit, check:coverage exit $coverageExit, check:curation exit $curationExit). See above."
    exit 1
}
Write-Host "`nDone: every Official Essay and the Curation is on the brand relays."
