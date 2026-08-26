import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileVaultStore } from './vault-store.js';

function withTempVaultDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-vault-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('load returns null for a coordinate that was never saved', () => {
  withTempVaultDir((dir) => {
    const store = createFileVaultStore(dir);
    assert.equal(store.load('30023:' + 'a'.repeat(64) + ':never-saved'), null);
  });
});

test('save then load round-trips the event verbatim', () => {
  withTempVaultDir((dir) => {
    const store = createFileVaultStore(dir);
    const coordinate = '30023:' + 'a'.repeat(64) + ':my-essay';
    const event = { id: 'abc', pubkey: 'a'.repeat(64), created_at: 123, kind: 30023, tags: [['d', 'my-essay']], content: 'hi', sig: 'deadbeef' };

    store.save(coordinate, event);

    assert.deepEqual(store.load(coordinate), event);
  });
});

test('a coordinate containing colons round-trips through a safe filename', () => {
  withTempVaultDir((dir) => {
    const store = createFileVaultStore(dir);
    const coordinate = '30023:' + 'b'.repeat(64) + ':my-own-private-idaho-x-1991';
    const event = { id: 'xyz', pubkey: 'b'.repeat(64), created_at: 1, kind: 30023, tags: [], content: '', sig: '00' };

    store.save(coordinate, event);

    assert.deepEqual(store.load(coordinate), event);
    // The directory must contain exactly one file, with no literal ":" —
    // colons are not valid in Windows filenames.
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    assert.ok(!files[0].includes(':'));
  });
});

test('save creates the vault directory if it does not exist yet', () => {
  withTempVaultDir((dir) => {
    const nested = path.join(dir, 'nested', 'essays');
    const store = createFileVaultStore(nested);
    const coordinate = '30023:' + 'c'.repeat(64) + ':nested-test';

    store.save(coordinate, { id: '1', pubkey: 'c'.repeat(64), created_at: 1, kind: 30023, tags: [], content: '', sig: '00' });

    assert.ok(fs.existsSync(nested));
    assert.equal(store.load(coordinate).id, '1');
  });
});

test('load returns null for a corrupt (non-JSON) vault file rather than throwing', () => {
  withTempVaultDir((dir) => {
    const store = createFileVaultStore(dir);
    const coordinate = '30023:' + 'd'.repeat(64) + ':corrupt';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${encodeURIComponent(coordinate)}.json`), 'not json{{{', 'utf8');

    assert.equal(store.load(coordinate), null);
  });
});

test('save overwrites a previous copy for the same coordinate', () => {
  withTempVaultDir((dir) => {
    const store = createFileVaultStore(dir);
    const coordinate = '30023:' + 'e'.repeat(64) + ':updated';

    store.save(coordinate, { id: 'v1', pubkey: 'e'.repeat(64), created_at: 1, kind: 30023, tags: [], content: 'old', sig: '00' });
    store.save(coordinate, { id: 'v2', pubkey: 'e'.repeat(64), created_at: 2, kind: 30023, tags: [], content: 'new', sig: '01' });

    assert.equal(store.load(coordinate).id, 'v2');
  });
});
