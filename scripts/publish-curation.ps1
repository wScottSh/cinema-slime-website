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
# Expect `Accepted by N/3 relays` (N >= 1) and `✅ List verified`.

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

try {
    $env:BRAND_SECRET_KEY = $keyHex
    Push-Location $repoRoot
    try {
        npm run publish:curation
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:\BRAND_SECRET_KEY -ErrorAction SilentlyContinue
    $keyHex = $null
    [GC]::Collect()
}
