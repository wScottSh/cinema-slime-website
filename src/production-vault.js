// The single production wiring of EssayVault: a SimplePool-backed RelayPort
// plus the committed filesystem VaultStore, reading back from the brand's
// READER_RELAYS by default (see #156).
//
// Every script that needs a real (non-test) vault — the publish gate
// (publish-curation.mjs), the read-only audit (check-curation.mjs), the
// curate-time capture (curate-essay/extract.mjs), and the one-off Idaho
// capture (capture-idaho-essay.mjs) — builds it through here instead of
// repeating the { relayPort: createRelayPort(pool), store: createFileVaultStore(),
// readerRelays } construction, so that production wiring lives in exactly one
// place. Tests still construct EssayVault directly with in-memory doubles.
import { createEssayVault } from './essay-vault.js';
import { createFileVaultStore } from './vault-store.js';
import { createRelayPort } from './relay-port.js';
import { READER_RELAYS } from './brand.js';

// pool: a SimplePool (or compatible) whose lifetime the caller owns and closes.
// readerRelays defaults to the brand's reader set; writerRelays defaults to the
// reader set inside createEssayVault when omitted. relayPort defaults to a
// fresh RelayPort over `pool`; a caller that also needs the port directly (the
// curate flow hands the same port to captureEssayFromInput for pointer fetches)
// can build it once and pass it in, so both share one wrapper over the pool.
export function createProductionVault(pool, { relayPort = createRelayPort(pool), readerRelays = READER_RELAYS, writerRelays } = {}) {
  return createEssayVault({
    relayPort,
    store: createFileVaultStore(),
    readerRelays,
    writerRelays,
  });
}
