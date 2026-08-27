// VaultStore — where EssayVault persists the brand's own captured copy of
// each Official Essay's original signed event.
//
// This is an internal seam, not exposed on EssayVault's public interface (see
// #156's implementation decisions): EssayVault is constructed with a store,
// but callers never pass a store per-call. Production uses this file-backed
// store, committing each captured event as JSON under vault/essays/ so the
// brand's owned copies are auditable in review and reproducible from a clean
// checkout. Tests use a plain in-memory Map instead (see essay-vault.test.js).
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_VAULT_DIR = path.join(process.cwd(), 'vault', 'essays');

// Coordinates ("30023:<pubkey>:<identifier>") contain characters (":") that
// are not safe in filenames on every platform. encodeURIComponent produces a
// deterministic, reversible, cross-platform-safe filename without needing a
// separate index file.
function filenameFor(coordinate) {
  return `${encodeURIComponent(coordinate)}.json`;
}

export function createFileVaultStore(vaultDir = DEFAULT_VAULT_DIR) {
  return {
    // Returns the captured event for `coordinate`, or null if never captured
    // (or the file is missing/corrupt — treated the same as "not captured").
    load(coordinate) {
      const file = path.join(vaultDir, filenameFor(coordinate));
      if (!fs.existsSync(file)) return null;
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },

    // Persist the author's original signed event verbatim. Pretty-printing
    // for review readability does not change the signed fields (id, pubkey,
    // created_at, kind, tags, content, sig) that get re-broadcast — those are
    // read back byte-for-byte from the parsed object, never re-serialized
    // through this formatting on the wire.
    save(coordinate, event) {
      fs.mkdirSync(vaultDir, { recursive: true });
      const file = path.join(vaultDir, filenameFor(coordinate));
      fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
    },
  };
}
