// One-off capture: un-strand Renn's "My Own Private Idaho" (#156, #157).
//
// This is the first real EssayVault entry. It captures the Essay's original
// signed kind:30023 event — Primal's "Copy Raw Data" for the Idaho
// coordinate, saved as a JSON file — verifies its signature and coordinate,
// stores it verbatim in the committed vault, then mirrors it to the relays
// the site reads and confirms it round-trips.
//
// Usage:
//   node scripts/capture-idaho-essay.mjs <path-to-raw-signed-event.json>
//
// No secret key is needed: the vault re-broadcasts the author's own signed
// bytes verbatim — it never signs anything itself.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SimplePool } from 'nostr-tools/pool';
import { createEssayVault } from '../src/essay-vault.js';
import { createFileVaultStore } from '../src/vault-store.js';
import { createRelayPort } from '../src/relay-port.js';
import { READER_RELAYS } from '../src/brand.js';

const EXPECTED_COORDINATE = '30023:36220acef401d61af98054b669316ac0045adc12e463e618a7297f4098ffcbd0:my-own-private-idaho-x-1991';

export async function main(rawJsonPath) {
  if (!rawJsonPath) {
    throw new Error('Usage: node scripts/capture-idaho-essay.mjs <path-to-raw-signed-event.json>');
  }
  const raw = fs.readFileSync(rawJsonPath, 'utf8');

  const pool = new SimplePool();
  try {
    const vault = createEssayVault({
      relayPort: createRelayPort(pool),
      store: createFileVaultStore(),
      readerRelays: READER_RELAYS,
    });

    const coordinate = vault.captureEssay(raw);
    console.log(`Captured: ${coordinate}`);
    if (coordinate !== EXPECTED_COORDINATE) {
      console.warn(`Warning: captured coordinate does not match the expected Idaho coordinate (${EXPECTED_COORDINATE}).`);
    }

    console.log('Mirroring to the reader relays and confirming read-back...');
    const report = await vault.ensurePresence([coordinate]);
    console.log(JSON.stringify(report, null, 2));

    if (!report.ok) {
      throw new Error(`EssayVault: presence not confirmed for: ${report.missing.join(', ')}`);
    }
    console.log('EssayVault: presence confirmed — the Essay is now readable from the relays the site reads.');
    return report;
  } finally {
    pool.close(READER_RELAYS);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
