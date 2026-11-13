#!/usr/bin/env bash
#
# Prints the nginx include that holds the Sender secrets, for
# /etc/nginx/cinemaslime-secrets/sender.conf (see
# cinemaslime-newsletter-location.conf). Reads SENDER_API_TOKEN and
# SENDER_GROUP_ID from the environment, never from argv, so neither value is on
# any process's command line.
#
#   SENDER_API_TOKEN=… SENDER_GROUP_ID=… bash deploy/nginx/render-sender-secret.sh
#
# The values are pasted into nginx config as root, so the alphabet check is the
# whole defence: a `"`, `;`, `$`, `\`, space or newline in a token could close
# the string and append directives, or interpolate a variable. Both alphabets
# are wider than anything Sender is known to issue (a JWT or a Laravel `id|key`
# token; six-character group ids such as eZVD4w) and contain nothing nginx or
# JSON treats specially. The group id also lands inside the JSON body, which
# is why it gets the narrower one.
set -euo pipefail

token="${SENDER_API_TOKEN:-}"
group="${SENDER_GROUP_ID:-}"
token_alphabet='^[A-Za-z0-9._~+/=|-]{1,2048}$'
group_alphabet='^[A-Za-z0-9]{1,64}$'

if [[ ! "$token" =~ $token_alphabet ]]; then
    echo "render-sender-secret: SENDER_API_TOKEN is empty or has a character outside [A-Za-z0-9._~+/=|-]; refusing to write it into nginx config" >&2
    exit 1
fi
if [[ ! "$group" =~ $group_alphabet ]]; then
    echo "render-sender-secret: SENDER_GROUP_ID is empty or not alphanumeric; refusing to write it into nginx config" >&2
    exit 1
fi

printf '# Written by deploy-live.yml from the SENDER_API_TOKEN and SENDER_GROUP_ID repo secrets.\n'
printf 'set $sender_token "%s";\n' "$token"
printf 'set $sender_group "%s";\n' "$group"
