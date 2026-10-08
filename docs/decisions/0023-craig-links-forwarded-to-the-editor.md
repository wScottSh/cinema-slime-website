# The Curator forwards Craig links to the editor over the WireGuard tunnel

**Date**: 2026-10-07
**Status**: accepted
**Amends**: ADR 0021 (the Curator)
**Context**: A podcast session is recorded in Discord by Craig, which DMs a link like `https://craig.horse/rec/<id>?key=<key>`. The cs-pod-editor, which turns a Craig recording into an Episode, runs on Unicron, not on the droplet. The ask: @mention the Curator with the Craig link in #admin-convos, the way an Essay link is curated, and have the editor start the Episode.

---

## Decisions

### 1. A Craig link is its own command, parsed with the others

`parseMention` (`src/curation-command.js`) yields `{ kind: 'intake', craig: { id, key }, title? }` for a message with one Craig link on `craig.horse` or `craig.chat`. The title is the rest of the message, with the bot mention and the link removed.

- Only `id` and `key` leave the parser. A Craig link can also carry `delete=`, the key that deletes the recording, and it is never stored, logged, or sent.
- A Craig link with no usable `key` is `unknown` (`craig-needs-key`), not an intake, so the reply says what is missing.
- A message with a Craig link and any second link (a Nostr link or another Craig link) is `unknown` (`two-links`). The Curator refuses rather than guesses, and the unused link would otherwise become part of the title.
- The break-glass CLI has no intake verb. The editor has its own tools.

### 2. The daemon routes intake to `bot/intake.js`; the journal and the reply are shared

`createMentionHandler` sends an intake to `intake.run(command, mention)` and every other command to `curator.run`. The 👀 reaction, the per-message journal, and the one reply work the same for both, so a redelivered mention is not handled twice. The editor is also idempotent on the Craig id: a replay after a crash gets `200` and the `exists` reply.

`bot/intake.js` makes one `POST https://10.77.0.2:8790/api/intake` with `{ craig, discord: { guildId, channelId, messageId, authorId }, title? }` and a bearer secret, and maps the answer to an Outcome. Each variant has its own template in `bot/outcome.js`:

| Editor answer | Outcome |
|---|---|
| `201` | `episode` `created`: the link, and that upload folders will be posted in the channel once Craig's audio is saved |
| `200` | `episode` `exists`: the link |
| `422` with `invalid_key`, `no_rec`, `recording_deleted`, `rec_no_data`, `invalid_rec` | `refused` `craig-<code>`, one message per code |
| `422` with another code | `refused` `craig-other`, naming the code |
| `422` with `craig_unreachable` | `failed` `craig` |
| `401` | `failed` `editor-auth` |
| `400`, or any answer off the contract | `failed` `editor-response` |
| `5xx`, refused connection, no answer in 20 s | `failed` `editor` |
| a certificate other than the pinned one | `failed` `editor-cert` |
| no `intake` config or an empty secret | `failed` `intake-off` |

The bot's job ends with that reply. The editor posts everything later (upload folders, the ready link, failures) to the channel through its own webhook.

### 3. The editor's certificate is pinned by fingerprint

The editor's certificate is self-signed and names no host or IP, so neither CA nor hostname verification can pass. `bot/intake.js` opens the TLS socket with chain verification off, compares the leaf certificate's SHA-256 fingerprint with `intake.certSha256` from `config.json`, and destroys the socket on any mismatch. The HTTP request is created only after the fingerprint matches, so the secret is never written to an unpinned connection. `bot/intake.test.js` runs a local HTTPS server with a second throwaway certificate and checks that it receives nothing.

When the editor's certificate is replaced, `intake.certSha256` must change with it; until then every intake gets the `editor-cert` reply.

### 4. Configuration is optional; curation never depends on it

- `config.json` gains `intake: { url, certSha256 }`.
- The secret is a systemd credential, `cspod-intake-secret`, loaded like the others. It is the editor's `CSPOD_INTAKE_SECRET`. The deploy workflow ships it from the optional GitHub secret `CSPOD_INTAKE_SECRET`; when that is unset, the droplet keeps the copy it has.
- `LoadCredential=` fails the unit when the file is missing, so the installer creates the credential empty when nothing was shipped. An empty secret, a missing or malformed `intake` block, or a non-`https` URL makes every intake answer `intake-off`, and Essay curation keeps working.

### 5. The tunnel is the only path

The droplet is `10.77.0.1` on the `cspod` WireGuard tunnel and may open TCP to `10.77.0.2:8790` and nothing else. The bot still opens no listening socket (ADR 0021): it is a client of the editor, as it is of Discord and the relays.

## Alternatives considered

- **The editor reads Discord itself.** A second bot in the channel would need its own token and its own redelivery handling, and two bots would answer the same mention. Lost on duplication.
- **Trust the self-signed certificate as a CA** (`ca: <pem>`). The certificate names no host, so Node's hostname check would still have to be replaced, and the droplet would hold a PEM instead of one line of config. Lost on size: the fingerprint pin is the same trust in less.
- **Pick the Craig link when a Nostr link is also present.** The Nostr link would become part of the Episode title. Lost to refusing.

## Consequences

- Starting an Episode is one mention, and the reply arrives as soon as the editor answers (at most 20 s).
- A rotated editor certificate or secret breaks intake until the droplet config or credential is updated; the reply names which one.
- The Curator now depends on a host it does not control for one command. An editor or tunnel outage gets the `editor` reply and changes nothing else.
