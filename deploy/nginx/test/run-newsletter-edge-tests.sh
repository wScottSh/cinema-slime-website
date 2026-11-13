#!/usr/bin/env bash
#
# Proves deploy/nginx/cinemaslime-newsletter-*.conf against real nginx in docker
# and a fake Sender. See newsletter-edge-harness.mjs for what it builds.
#
#   bash deploy/nginx/test/run-newsletter-edge-tests.sh            (or: npm run test:newsletter-edge)
#   bash deploy/nginx/test/run-newsletter-edge-tests.sh --serve    keep the stack up for a browser
#
# Needs docker and openssl, and the nginx:1.24 and node:22-bookworm images
# (pulled on first use). Touches nothing outside a mktemp dir and its own
# containers and network, which it removes on exit.
set -euo pipefail
command -v docker  >/dev/null || { echo "run-newsletter-edge-tests: docker is required" >&2; exit 1; }
command -v openssl >/dev/null || { echo "run-newsletter-edge-tests: openssl is required" >&2; exit 1; }
exec node "$(dirname "$0")/newsletter-edge-harness.mjs" "$@"
