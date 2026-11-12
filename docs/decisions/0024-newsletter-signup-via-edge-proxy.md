# Newsletter signup through the nginx edge

**Date**: 2026-11-12
**Status**: accepted
**Amends**: ADR 0011 (the fold), in placement only
**Context**: The brand wants a mailing list for new Episodes and Essays, run on Sender (sender.net). Sender's API takes a new subscriber with `POST /v2/subscribers` and a bearer token. That token is full-account access, and Sender answers a signup with the stored subscriber record. The site is static files behind nginx on the droplet, with no app server (ADR 0006) beyond the Curator bot (ADR 0021).

---

## Decisions

### 1. nginx makes the Sender call, with stock modules only

`POST /api/newsletter` is a `location` in `deploy/nginx/cinemaslime-newsletter-location.conf`, installed by the edge installer like every other snippet. nginx validates the address, writes the whole upstream request itself, and calls Sender. The token and the group id live in `/etc/nginx/cinemaslime-secrets/sender.conf` (root, 0700/0600), written on every deploy from the `SENDER_API_TOKEN` and `SENDER_GROUP_ID` repo secrets. That directory is outside `conf.d/` and `snippets/` because the installer removes any `cinemaslime-*.conf` there that the repo does not ship. The site never depends on that file to start: each location sets both variables to `""` and includes the file through a glob (`sender.con[f]`), which may match nothing, so a missing or empty file turns the signup into a `503` and nothing else. The deploy writes the file to a temp name and renames it into place only when complete, because a truncated include would fail to parse.

The wire contract the browser sees:

| Answer | When |
|---|---|
| `204`, empty | Sender accepted the address |
| `422` | the header is missing or fails the edge's pattern |
| `405` | any method but POST |
| `429` | more than 4 a minute (burst 4) from one client address |
| `503` | the token is empty, or the secret include is missing or empty |
| `502` | anything Sender or the network does wrong: any non-2xx, a timeout (3 s connect, 5 s read), a certificate that fails verification |

### 2. The address travels in a header

nginx cannot read a request body before it proxies, so a body could not be validated at the edge. The `X-Newsletter-Email` header can, in the rewrite phase, before anything goes upstream. The pattern is conservative on purpose: its alphabet has no quote, backslash, control or space character, so the address cannot break out of the JSON string nginx pastes it into, and a lookahead caps it at 254 characters. It also refuses shapes Sender rejects, so a typo is answered `422` ("check the address") rather than `502` ("try again later"): the local part and every domain label start and end with a letter or digit, the local part has no `..`, and the last label is two or more letters. That last rule refuses internationalized top-level domains in their `xn--` form, which the alphabet already did for their Unicode form. The default access log format records the request line, referer and user agent, so the address is not logged either. `src/newsletter.js` holds the same pattern for the browser's own check, and a test fails if the two drift. The one allowed difference is the anchors: nginx's copy uses `\A` and `\z`, because PCRE's `$` also matches before a trailing newline, while JavaScript's `^` and `$` are already exact.

### 3. Sender's answer never reaches the browser

Anyone can post anyone's address, and Sender's success body is the subscriber's stored record. A plain `proxy_pass` would stream it through. The Sender call is therefore an `auth_request` subrequest, whose body nginx discards; only its status survives. The public location then answers `204` from a named location reached through `try_files`, which runs after the access phase. A bare `return 204` would not work: `return` runs in the rewrite phase, before `auth_request`, and would answer without calling Sender. The edge harness proves this: with `return 204` in place of `try_files`, its upstream assertions fail.

`auth_request` passes a `401` or `403` through with Sender's `WWW-Authenticate` header copied on, and turns every other failure into `500`. The subrequest intercepts `401`/`403` and the public location maps `500`, so the browser only ever sees a bare `502`. `auth_request` is in Ubuntu 24.04's nginx 1.24.0 build (`--with-http_auth_request_module`), and the harness passes against that package as well as the official `nginx:1.24` image.

Because this request carries a secret, it verifies Sender's certificate (`proxy_ssl_verify on`, the system CA bundle, `proxy_ssl_name api.sender.net`, depth 3), unlike the read-only proxies. It forwards nothing from the visitor: no cookies, no client address, no body.

### 4. One strip under the fold block

The signup is a low strip inside the hero, a sibling after `#hero-dynamic` and the same width as the marquee. It is not part of the fold block ADR 0011 composes: decision 1 there ("exactly one Episode and one Essay") is about what the marquee presents, and the strip sits outside it, after it, so the fold still says "here is the newest thing, and here is the newest writing" first. It uses the fold's own register (`.hero-stencil`, the squared ink-chewed button, a dark opaque panel with a hard shadow) and no new image assets (ADR 0011 decision 4). It is a sibling rather than a child of `#hero-dynamic` because fresh Episode or Essay data replaces that div wholesale and would wipe a half-typed address.

The strip's state is one discriminated union (`idle | submitting | subscribed | failed` with a `problem` of `invalid | rate-limited | unavailable`) advanced by a pure reducer. A subscriber is remembered with a `localStorage` flag, never the address, and is not asked again from that browser.

### 5. The edge contract checks the route without subscribing anyone

`verify:edge` runs against production every 6 hours with GET only. It sends a GET to `/api/newsletter` and requires `405` with `Allow: POST`. The SPA shell would answer `200 text/html`.

## Alternatives considered

- **Sender's embedded form.** Their markup and script on our page, and Sender branding on the free plan. Lost on the look the fold depends on and on a third-party script on the home page.
- **A small Node service on the droplet.** ADR 0006 keeps the droplet free of app servers, and ADR 0021 admitted one bot for one reason, with its own installer, credentials and restart story. A signup is one request with a fixed shape, which nginx can do. Lost on size.
- **The token in the browser.** It is full-account access. Rejected outright.
- **A request body instead of a header.** nginx cannot validate a body before proxying it, so the browser would control the upstream JSON. Rejected.

## Consequences

- **No double opt-in.** The signup adds the address directly; nothing asks its owner to confirm it. Anyone can sign up anyone else's address. The rate limit slows that down but does not stop it.
- **Coarse failure reasons.** The visitor learns "bad address", "too many tries" or "try again later". Sender's own reasons (a duplicate, a full plan, a bad token) all read as the last.
- **The free plan's 2,500-subscriber cap can be filled by a script.** At 4 a minute per client address, one address fills it in about ten hours, and a script with many addresses faster. If that happens the signup answers `502` until the list is cleaned or the plan upgraded.
- **What Sender returns for a repeat signup is undocumented.** If it is not 2xx, a returning subscriber on a new browser is told to try again later. `scripts/setup-sender.sh` ends with an optional double signup that settles it.
- A deploy now requires `SENDER_API_TOKEN` and `SENDER_GROUP_ID`; `deploy-live.yml` fails first, naming `scripts/setup-sender.sh`, when either is missing.
- A rotated token takes effect on the next push to `live`: the deploy rewrites the include and the installer reloads nginx.
- The scheduled `verify:edge` checks out `live`, so the new check starts running only once it is deployed. Run from `main`, it would fail every 6 hours between the merge and the first deploy.
- `npm run test:newsletter-edge` runs the committed confs in real nginx against a fake Sender with its own CA, in CI, without secrets. See `docs/deploy/nginx-newsletter-proxy.md`.
