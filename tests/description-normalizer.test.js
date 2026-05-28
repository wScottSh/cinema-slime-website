import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDescription } from '../src/description-normalizer.js';
import fs from 'node:fs';
import path from 'node:path';

const fixturesPath = path.join(import.meta.dirname, 'fixtures', 'description-samples.json');
const samples = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

describe('Description Normalizer (pure function)', () => {
  describe('contract', () => {
    it('returns { cleanedHtml, rawHtml } shape for string input', () => {
      const result = normalizeDescription('<p>hello</p>');
      assert.ok(result && typeof result === 'object');
      assert.strictEqual(typeof result.cleanedHtml, 'string');
      assert.strictEqual(typeof result.rawHtml, 'string');
    });

    it('always returns the original rawHtml unchanged (identity)', () => {
      const input = samples.fullWithTs;
      const result = normalizeDescription(input);
      assert.strictEqual(result.rawHtml, input);
      assert.notStrictEqual(result.cleanedHtml, input);
    });

    it('handles null/undefined/non-string gracefully', () => {
      assert.deepStrictEqual(normalizeDescription(null), { cleanedHtml: '', rawHtml: '' });
      assert.deepStrictEqual(normalizeDescription(undefined), { cleanedHtml: '', rawHtml: '' });
      assert.deepStrictEqual(normalizeDescription(123), { cleanedHtml: '', rawHtml: '' });
      assert.deepStrictEqual(normalizeDescription({}), { cleanedHtml: '', rawHtml: '' });
    });

    it('handles empty string', () => {
      const result = normalizeDescription('');
      assert.strictEqual(result.cleanedHtml, '');
      assert.strictEqual(result.rawHtml, '');
    });
  });

  describe('real RSS samples - full episodes with timestamps', () => {
    const cases = [
      { name: 'fullWithTs (Tenet)', key: 'fullWithTs', hasTs: '(19:02)', hasProse: 'TENET' },
      { name: 'gattaca', key: 'gattaca', hasTs: '(8:50)', hasProse: 'Gattaca' },
      { name: 'awards', key: 'awards', hasTs: '(5:15)', hasProse: 'Slimey Awards' },
    ];

    for (const c of cases) {
      it(`strips boilerplate from ${c.name} but preserves content and timestamps`, () => {
        const input = samples[c.key];
        const { cleanedHtml } = normalizeDescription(input);

        // Must preserve episode-specific content
        assert.ok(cleanedHtml.includes(c.hasTs), `should keep timestamp ${c.hasTs}`);
        assert.ok(cleanedHtml.includes(c.hasProse), `should keep prose mention of ${c.hasProse}`);

        // Must remove known boilerplate
        assert.ok(!cleanedHtml.includes('EXPERIENCE MOVIES WITH US'), 'should remove EXPERIENCE block');
        assert.ok(!cleanedHtml.includes('Subscribe to the'), 'should remove subscribe block');
        assert.ok(!cleanedHtml.includes('Hosts: Harrison'), 'should remove hosts block');
        assert.ok(!cleanedHtml.includes('patreon.com/CinemaSlime'), 'should remove patreon links');
        assert.ok(!cleanedHtml.includes('discord.gg'), 'should remove discord links');
        assert.ok(!cleanedHtml.includes('Buy Me A Coffee'), 'should remove coffee links');

        // Result should be meaningfully shorter
        assert.ok(cleanedHtml.length < input.length * 0.6, 'cleaned should be substantially shorter');
        assert.ok(cleanedHtml.length > 200, 'should still have substantial content');
      });
    }
  });

  describe('real RSS samples - bonus and short formats', () => {
    it('strips boilerplate from bonus-like tithing notice but keeps the actual content', () => {
      const input = samples.bonusLike;
      const { cleanedHtml } = normalizeDescription(input);

      assert.ok(cleanedHtml.includes('Tithing Notice'), 'keep bonus content');
      assert.ok(cleanedHtml.includes('Forgive Me Lord, For I Have Synthed'), 'keep category title');
      assert.ok(cleanedHtml.includes('synthesizer'), 'keep prose');

      assert.ok(!cleanedHtml.includes('EXPERIENCE MOVIES'), 'remove EXPERIENCE');
      assert.ok(!cleanedHtml.includes('Subscribe to the'), 'remove subscribe');
      assert.ok(!cleanedHtml.includes('patreon'), 'remove socials');
    });

    it('strips subscribe/social boilerplate from short solo episode (no EXPERIENCE block)', () => {
      const input = samples.shortSolo;
      const { cleanedHtml } = normalizeDescription(input);

      assert.ok(cleanedHtml.includes('A Knight of the Seven Kingdoms'), 'keep episode title');
      assert.ok(cleanedHtml.includes('Episode 6'), 'keep episode number ref');
      assert.ok(cleanedHtml.includes('Marrow'), 'keep specific episode part');

      assert.ok(!cleanedHtml.includes('Subscribe to the'), 'remove subscribe CTA');
      assert.ok(!cleanedHtml.includes('Hosts:'), 'remove hosts');
      assert.ok(!cleanedHtml.includes('patreon.com'), 'remove patreon');
      assert.ok(!cleanedHtml.includes('DISCORD'), 'remove discord');
    });
  });

  describe('preserves structure and edge cases', () => {
    it('keeps inner HTML structure for timestamps and emphasis (no text-only stripping)', () => {
      const input = samples.fullWithTs;
      const { cleanedHtml } = normalizeDescription(input);

      assert.ok(cleanedHtml.includes('<strong>(19:02)'), 'timestamp strong tags preserved');
      assert.ok(cleanedHtml.includes('</strong>'), 'closing tags kept');
      assert.ok(cleanedHtml.includes('<p>'), 'paragraphs kept');
    });

    it('is idempotent: normalizing already-cleaned output yields same cleanedHtml', () => {
      const input = samples.gattaca;
      const first = normalizeDescription(input).cleanedHtml;
      const second = normalizeDescription(first).cleanedHtml;
      assert.strictEqual(second, first);
    });

    it('handles plain text with no HTML and no boilerplate', () => {
      const input = 'Just some episode notes here (12:34) timestamp preserved.';
      const { cleanedHtml, rawHtml } = normalizeDescription(input);
      assert.strictEqual(cleanedHtml, input);
      assert.strictEqual(rawHtml, input);
    });

    it('handles HTML that is only boilerplate (results in empty cleaned)', () => {
      const onlyBoiler = '<p><strong>EXPERIENCE MOVIES WITH US!</strong></p><p>Subscribe...</p>';
      const { cleanedHtml } = normalizeDescription(onlyBoiler);
      assert.strictEqual(cleanedHtml.trim(), '');
    });
  });
});
