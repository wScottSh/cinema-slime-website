import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyFreshData } from './revalidation-policy.js';

const idle = { searching: false, scrolled: false };

test('identical guids → hold with reason no-change', () => {
  const cached = [{ guid: 'a' }, { guid: 'b' }];
  const fresh  = [{ guid: 'a' }, { guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'no-change');
});

test('changed guids + idle → apply', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'apply');
});

test('changed guids + searching → hold with reason interacting', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: true, scrolled: false } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('changed guids + scrolled → hold with reason interacting', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: false, scrolled: true } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('changed guids + searching and scrolled → hold with reason interacting', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: true, scrolled: true } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('undefined cached (cold load) → apply regardless of interacting state', () => {
  const fresh = [{ guid: 'a' }];
  const result = shouldApplyFreshData({ cached: undefined, fresh, interacting: { searching: true, scrolled: true } });
  assert.equal(result.decision, 'apply');
});

test('different guid count → changed → apply when idle', () => {
  const cached = [{ guid: 'a' }, { guid: 'b' }];
  const fresh  = [{ guid: 'a' }, { guid: 'b' }, { guid: 'c' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'apply');
});

test('different guid count + searching → hold', () => {
  const cached = [{ guid: 'a' }];
  const fresh  = [{ guid: 'a' }, { guid: 'b' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: { searching: true, scrolled: false } });
  assert.equal(result.decision, 'hold');
  assert.equal(result.reason, 'interacting');
});

test('empty cached array + non-empty fresh + idle → apply', () => {
  const cached = [];
  const fresh  = [{ guid: 'a' }];
  const result = shouldApplyFreshData({ cached, fresh, interacting: idle });
  assert.equal(result.decision, 'apply');
});
