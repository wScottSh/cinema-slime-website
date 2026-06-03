import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidSlug } from './essay-slug.js';

test('isValidSlug accepts well-formed slugs', () => {
  assert.equal(isValidSlug('first'), true);
  assert.equal(isValidSlug('hello-world'), true);
  assert.equal(isValidSlug('abc123'), true);
  assert.equal(isValidSlug('a-b-c'), true);
  assert.equal(isValidSlug('1st'), true);
});

test('isValidSlug rejects uppercase letters', () => {
  assert.equal(isValidSlug('First'), false);
  assert.equal(isValidSlug('HELLO'), false);
  assert.equal(isValidSlug('hEllo'), false);
});

test('isValidSlug rejects spaces', () => {
  assert.equal(isValidSlug('hello world'), false);
  assert.equal(isValidSlug(' first'), false);
  assert.equal(isValidSlug('first '), false);
});

test('isValidSlug rejects leading or trailing hyphens', () => {
  assert.equal(isValidSlug('-first'), false);
  assert.equal(isValidSlug('first-'), false);
});

test('isValidSlug rejects double hyphens', () => {
  assert.equal(isValidSlug('hello--world'), false);
});

test('isValidSlug rejects colons (can never be parsed as a coordinate)', () => {
  assert.equal(isValidSlug('30023:abc:slug'), false);
  assert.equal(isValidSlug('with:colon'), false);
});

test('isValidSlug rejects empty string', () => {
  assert.equal(isValidSlug(''), false);
});

test('isValidSlug rejects non-string inputs', () => {
  assert.equal(isValidSlug(null), false);
  assert.equal(isValidSlug(undefined), false);
  assert.equal(isValidSlug(42), false);
});
