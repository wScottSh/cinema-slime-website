# nginx newsletter signup proxy

How the home page's newsletter strip subscribes an address to Sender. The
browser sends one same-origin `POST /api/newsletter` with the address in the
`X-Newsletter-Email` header. nginx on the droplet validates it, builds Sender's
request itself, calls `https://api.sender.net/v2/subscribers` with the brand's
token, and answers with a status only. Implements ADR 0024.

- **Upstream:** `POST https://api.sender.net/v2/subscribers`, `Authorization: Bearer <token>`
- **Body nginx sends:** exactly `{"email":"<address>","groups":["<group id>"]}`
- **Path:** `/api/newsletter`, POST only
- **Answers:** `204` subscribed · `422` bad or missing address · `405` other method · `429` rate limited · `503` no token · `502` any Sender or network failure
- **Droplet:** `root@161.35.188.75`
- **Secrets:** `SENDER_API_TOKEN`, `SENDER_GROUP_ID` (GitHub Actions, set by `scripts/setup-sender.sh`)

Locally there is no nginx. `vite.config.js` proxies `/api/newsletter` to
`NEWSLETTER_EDGE_URL`. Unset, the request fails and the strip shows its
"try again" message, so `npm run dev` never reaches Sender.

## Config (committed)

- `deploy/nginx/cinemaslime-newsletter-cache.conf`. The `limit_req_zone`
  (4 a minute per client, where a client is an IPv4 address or an IPv6 /64,
  through the `map` that sets `$newsletter_client`). It holds no cache; the `-cache.conf` name is
  how the installer knows it belongs in `http{}`. CI installs it into
  `/etc/nginx/conf.d/`.
- `deploy/nginx/cinemaslime-newsletter-location.conf`. The public
  `location = /api/newsletter`, the internal `location = /_newsletter/subscribe`
  that calls Sender, and two named locations for the answers. CI installs it
  into `/etc/nginx/snippets/` and `include`s it from the managed marker block.
- `deploy/nginx/render-sender-secret.sh`. Prints the secret include from
  `SENDER_API_TOKEN` and `SENDER_GROUP_ID`, and refuses any value outside
  `[A-Za-z0-9._~+/=|-]` (token) or `[A-Za-z0-9]` (group id), so a secret can
  never close its quoted string and add a directive.

The secret include itself is not in the repo. `deploy-live.yml` writes it to
`/etc/nginx/cinemaslime-secrets/sender.conf` (directory 0700, file 0600, root)
before the edge install. It sets two variables:

```nginx
set $sender_token "…";
set $sender_group "…";
```

It lives outside `conf.d/` and `snippets/` because the installer removes every
`cinemaslime-*.conf` there that the repo does not ship.

**A missing secret never stops nginx.** Both locations that read it first set
`$sender_token` and `$sender_group` to `""`, then include it through the glob
`sender.con[f]`. A glob that matches nothing is not an error, so with the file
missing or empty nginx starts, the rest of the site serves, and every signup
answers `503` without calling Sender. A truncated file would still fail to
parse, so the deploy never writes it in place (see below).

### Why these directives

- `if ($request_method != POST) { … return 405; }` and the `if
  ($http_x_newsletter_email !~ "…") { return 422; }` regex both run in the
  rewrite phase, before the rate limit and before any upstream call. The
  regex's alphabet has no quote, backslash, control or space character, which
  is what makes pasting the header into JSON safe, and its lookahead caps the
  length at 254. The local part and each domain label must start and end
  with a letter or digit, the local part has no `..`, and the last label is
  two or more letters, so addresses Sender would refuse are a `422` here, not
  a `502`. It anchors with `\A` and `\z`, not `^` and `$`: PCRE's `$`
  also matches before a trailing newline.
- `set $sender_token ""; set $sender_group "";` before
  `include …/sender.con[f];`. The variables always exist, and the include may
  match nothing. Then `if ($sender_token = "") { return 503; }`: a missing or
  empty token answers without calling Sender.
- `limit_req zone=newsletter burst=4 nodelay` with `limit_req_status 429`. The
  status is set in the location, not in `http{}`, so other `limit_req` users on
  the box keep their own.
- `auth_request /_newsletter/subscribe`. The subrequest calls Sender and nginx
  keeps only its status, so no byte of Sender's body (which echoes the stored
  subscriber) reaches the browser.
- `try_files /.newsletter-never-a-file @newsletter_subscribed`. Answers `204`
  after the access phase. `return 204` here would run before `auth_request`
  and skip Sender entirely.
- `error_page 500 =502` in the public location, and `proxy_intercept_errors on`
  plus `error_page 401 403 =502` in the subrequest. `auth_request` passes
  `401`/`403` through with Sender's `WWW-Authenticate` header, and turns every
  other failure into `500`. Both become a bare `502`.
- `proxy_pass https://$sender_upstream/…` with a location-scoped `resolver`.
  The lookup happens per request, so DNS trouble fails one signup and never
  stops nginx from starting (ADR 0014).
- `proxy_ssl_verify on`, `proxy_ssl_trusted_certificate
  /etc/ssl/certs/ca-certificates.crt`, `proxy_ssl_name api.sender.net`,
  `proxy_ssl_verify_depth 3`. The request carries a full-account token, so it
  must reach the real Sender. Depth 3 allows a chain with up to two
  intermediates.
- `proxy_pass_request_headers off` and explicit `proxy_set_header` lines. No
  visitor cookie, client address or body is forwarded. `proxy_set_body`
  writes the whole JSON body.
- `proxy_connect_timeout 3s`, `proxy_send_timeout 5s`, `proxy_read_timeout 5s`.
  A slow Sender costs a visitor seconds, not nginx's 60-second default.

Neither the address nor the token is logged. The address is in a request
header and the token in an upstream header, and the default `combined` access
log format records neither. The edge harness checks both logs.

**`nginx -T` prints the token.** It dumps every included file, the secret
include among them. Never paste its output into an issue, a chat, a PR or a
log. Use `nginx -t` to check the config; it prints no file contents.

## Apply to the droplet

**Nothing to do by hand once the secrets exist.** Until they do, every deploy
to `live` fails at its first step, for any change, so set up Sender before this
reaches `main` (see the launch checklist). `deploy-live.yml`, on every push to
`live`:

1. fails first, before touching the droplet, when `SENDER_API_TOKEN` or
   `SENDER_GROUP_ID` is empty;
2. renders the include with `render-sender-secret.sh` on the runner and pipes
   it over ssh to `deploy/nginx/install-sender-secret.sh`, whose text is the
   remote command, so neither value is on any command line. That script writes
   a `0600` temp file in the same directory and renames it over `sender.conf`
   only when its last line is the complete group line. A stream cut short
   leaves the previous include in place;
3. runs the edge installer, which installs both confs, runs `nginx -t`, and
   reloads. The reload is also what picks up a rotated token.

### Launch checklist

Do steps 1 and 2 before merging to `main`. From that merge on, every deploy to
`live` fails at its first step until both secrets exist, whatever it ships.

1. Run `scripts/setup-sender.sh`. It walks the Sender account, the sending
   domain (Account settings → Domains) and the company postal address (General
   settings), creates the API token (Settings → API access tokens, validity
   Forever), checks it against `GET /v2/groups`, picks the group, and sets both
   GitHub secrets.
2. Let the wizard's last stage sign one of your own addresses up twice, and
   note both statuses. Sender does not document what a repeat signup returns.
   If the second is not `200` or `201`, a returning subscriber is told to try
   again later; raise it before launch. Optionally, unsubscribe the address in
   Sender when the wizard asks; it then signs it up once more and reports the
   status and `status.email`. `active` would mean a signup from the site
   re-subscribes someone who opted out.
3. Merge to `main`, then to `live`. The deploy writes the secret, installs the
   snippet, and the pre-cutover `verify:edge` checks that GET
   `/api/newsletter` answers `405`.
4. Sign up once on https://cinemaslime.com and confirm the address appears in
   the chosen group in Sender.
5. Once the sending domain shows as verified in Sender, the list can be mailed.

### Break glass

Emergency-only manual steps are in
[`edge-config.md`](edge-config.md#break-glass-emergency-only). To turn the
signup off without a deploy, remove the include and reload; every signup then
answers `503` and nothing reaches Sender:

```sh
ssh root@161.35.188.75 'rm -f /etc/nginx/cinemaslime-secrets/sender.conf && nginx -t && systemctl reload nginx'
```

The next deploy writes the real token back.

## Verify

`npm run verify:edge` checks that the route exists without subscribing anyone:
a GET must answer `405` with `Allow: POST`, never the SPA shell.

`npm run test:newsletter-edge` proves the whole behavior against real nginx and
a fake Sender, in docker, without secrets. The real installer installs the
committed confs into the production vhost fixture. The only edit is the
resolver address (docker's DNS is `127.0.0.11`). A throwaway CA, with two
intermediates, is mounted as nginx's CA bundle, so certificate verification
is real. It asserts the exact upstream request, the `405`/`422`/`503`
answers, injection and length limits, every Sender failure as a bare `502`
with nothing leaked, hang and down timings, a wrong CA and a wrong host name
failing closed, the rate limit, and logs free of addresses and the token. A
plain-HTTP server of the harness's own on port 8081, never shipped, takes the
client address from a header (realip), so it can show the rate-limit key nginx
computes for IPv4, full and compressed IPv6, and IPv4-mapped addresses, and
drive the shipped signup location from many addresses in one /64. Without the
secret include it cold-starts nginx and checks that the site still serves.
`NEWSLETTER_EDGE_NGINX_IMAGE` selects another nginx image, such as one built
from Ubuntu's `nginx` package.

### End to end in a browser

```sh
npm run build
npm run test:newsletter-edge -- --serve
```

This serves `dist/` through the same stack on `0.0.0.0:8744` (self-signed
certificate; set `NEWSLETTER_EDGE_PORT` to change it), with the fake Sender
answering `201`. It prints the fake's control URL for reading what Sender
received and for switching its answer (`401`, `429`, `hang`, `wrong-ca`, …).
To run the Vite dev server against it instead:

```sh
NEWSLETTER_EDGE_URL=https://127.0.0.1:8744 npm run dev -- --host 0.0.0.0
```

Ctrl-C stops the stack and removes its containers.
