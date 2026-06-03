import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifestSlugs } from '../scripts/publish-curation.mjs';

test('validateManifestSlugs passes when no essays have slugs', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1' },
    { coordinate: '30023:abc:id2' },
  ]);
  assert.deepEqual(result, { valid: true });
});

test('validateManifestSlugs passes with valid unique slugs', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'first' },
    { coordinate: '30023:abc:id2', slug: 'second-essay' },
  ]);
  assert.deepEqual(result, { valid: true });
});

test('validateManifestSlugs fails with a malformed slug (uppercase)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'First' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'First');
  assert.ok(result.reason.length > 0);
});

test('validateManifestSlugs fails with a malformed slug (spaces)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'hello world' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'hello world');
});

test('validateManifestSlugs fails with a malformed slug (leading hyphen)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: '-bad' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, '-bad');
});

test('validateManifestSlugs fails with a malformed slug (double hyphen)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'hello--world' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'hello--world');
});

test('validateManifestSlugs fails with a malformed slug (colon)', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'with:colon' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'with:colon');
});

test('validateManifestSlugs fails with duplicate slugs', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'first' },
    { coordinate: '30023:abc:id2', slug: 'first' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'first');
  assert.ok(result.reason.includes('duplicate') || result.reason.includes('Duplicate'));
});

test('validateManifestSlugs reports the first offending slug on mixed input', () => {
  const result = validateManifestSlugs([
    { coordinate: '30023:abc:id1', slug: 'valid' },
    { coordinate: '30023:abc:id2', slug: 'INVALID' },
    { coordinate: '30023:abc:id3', slug: 'valid' },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.slug, 'INVALID');
});
