import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShowNotes, toSeconds } from './episode-notes.js';

// Trimmed from the real "Logan (2017)" notes, after normalizeDescription.
const LOGAN = [
  '<p><em>&quot;Nature made me a freak. Man made me a weapon.&quot;</em></p>',
  '<p><br></p>',
  '<p><strong>(7:15) MOVIES WE WATCHED</strong></p>',
  '<p><strong>(18:09) LOGAN x 2017</strong></p>',
  '<p><strong>(1:22:40) SLIMIEST SCENES + RATINGS</strong></p>',
  '<p><br></p>',
  '<p><strong>HARRISON’S PICK x DAD-TEMBER</strong></p>',
  '<p>In a bleak, near-future world where mutants are nearly extinct.</p>',
  '<p>From 2017 This is James Mangold’s film Logan.</p>',
].join('');

// --- toSeconds ---

test('toSeconds reads m:ss and h:mm:ss', () => {
  assert.equal(toSeconds('7:15'), 435);
  assert.equal(toSeconds('1:22:40'), 4960);
  assert.equal(toSeconds('01:33:56'), 5636);
});

test('toSeconds is 0 for anything unparseable', () => {
  assert.equal(toSeconds(''), 0);
  assert.equal(toSeconds(undefined), 0);
  assert.equal(toSeconds('soon'), 0);
});

// --- the weekly shape ---

test('parseShowNotes takes the opening italic line as the quote, without its quote marks', () => {
  assert.equal(parseShowNotes(LOGAN).quote, 'Nature made me a freak. Man made me a weapon.');
});

test('parseShowNotes lifts timestamped lines out as Chapters, in order, with seconds', () => {
  const { chapters } = parseShowNotes(LOGAN, '01:43:11');
  assert.deepEqual(chapters.map((c) => [c.at, c.secs, c.label]), [
    ['7:15', 435, 'MOVIES WE WATCHED'],
    ['18:09', 1089, 'LOGAN x 2017'],
    ['1:22:40', 4960, 'SLIMIEST SCENES + RATINGS'],
  ]);
});

test('each Chapter runs to the next, and the last runs to the end of the Episode', () => {
  const { chapters } = parseShowNotes(LOGAN, '01:43:11');
  assert.deepEqual(chapters.map((c) => c.len), [1089 - 435, 4960 - 1089, 6191 - 4960]);
});

test('the last Chapter has zero length when the Episode duration is unknown', () => {
  const { chapters } = parseShowNotes(LOGAN);
  assert.equal(chapters.at(-1).len, 0);
});

test('parseShowNotes reads the bold "X x Y" line as the billing', () => {
  assert.deepEqual(parseShowNotes(LOGAN).billing, { label: 'HARRISON’S PICK', theme: 'DAD-TEMBER' });
});

test('a timestamped "x" line is a Chapter, never the billing', () => {
  const { billing, chapters } = parseShowNotes('<p><strong>(18:09) LOGAN x 2017</strong></p>');
  assert.equal(billing, null);
  assert.equal(chapters.length, 1);
});

test('parseShowNotes leaves the synopsis as prose HTML', () => {
  const { proseHtml } = parseShowNotes(LOGAN);
  assert.equal(proseHtml, '<p>In a bleak, near-future world where mutants are nearly extinct.</p><p>From 2017 This is James Mangold’s film Logan.</p>');
});

// --- the variants the feed actually carries ---

test('Chapters with the stamp trailing, or with spaces inside the brackets, are read too', () => {
  const { chapters } = parseShowNotes('<p>FAMILY FEUD X FILM SPOILERS (6:40)</p><p>( 1:19:25 ) CATEGORY LOTTERY</p><p>(27:20 )THE SECRET OF NIMH x 1982</p>');
  assert.deepEqual(chapters.map((c) => [c.at, c.label]), [
    ['6:40', 'FAMILY FEUD X FILM SPOILERS'],
    ['27:20', 'THE SECRET OF NIMH x 1982'],
    ['1:19:25', 'CATEGORY LOTTERY'],
  ]);
});

test('the "TIMESTAMPS & MOMENTS COVERED" heading is dropped', () => {
  const { proseHtml } = parseShowNotes('<p>👇 <strong>TIMESTAMPS &amp; MOMENTS COVERED</strong> 👇</p><p>(5:40) QUIZ</p>');
  assert.equal(proseHtml, '');
});

test('billing that is not a pick is still billing', () => {
  assert.deepEqual(parseShowNotes('<p><strong>Week 2 DEEP DIVE x Deep Roy</strong></p>').billing, { label: 'Week 2 DEEP DIVE', theme: 'Deep Roy' });
});

test('a pick written on the right is swapped to the left', () => {
  assert.deepEqual(
    parseShowNotes('<p><strong>FORGIVE ME LORD, FOR I HAVE SYNTHED X Renn&#39;s Pick</strong></p>').billing,
    { label: "Renn's Pick", theme: 'FORGIVE ME LORD, FOR I HAVE SYNTHED' },
  );
});

test('a pick billed alone is billing with no theme', () => {
  assert.deepEqual(parseShowNotes('<p><strong>RENN&#39;S PICK </strong></p>').billing, { label: "RENN'S PICK", theme: '' });
});

test('a bold line that merely ends in "pick" is not billing', () => {
  assert.equal(parseShowNotes('<p><strong>This is the moment the whole cast agreed on as the pick</strong></p>').billing, null);
});

test('a bold opening line in quote marks is the quote', () => {
  assert.equal(parseShowNotes('<p><strong>“Dispose.... dispose..... DISPOSE!”</strong></p><p>Synopsis.</p>').quote, 'Dispose.... dispose..... DISPOSE!');
});

test('a bold opening line without quote marks is not the quote', () => {
  assert.equal(parseShowNotes('<p><strong>GET SLIMED!</strong></p>').quote, '');
});

test('quote marks around the theme are dropped', () => {
  assert.equal(parseShowNotes('<p><strong>RENN’S PICK x “DAD-TEMBER”</strong></p>').billing.theme, 'DAD-TEMBER');
});

test('an italic line after the synopsis has started is prose, not the quote', () => {
  const { quote, proseHtml } = parseShowNotes('<p>Intro.</p><p><em>An aside.</em></p>');
  assert.equal(quote, '');
  assert.ok(proseHtml.includes('An aside.'));
});

// --- degrading ---

test('notes that break the pattern fall through to prose untouched', () => {
  const html = '<p>Someone in the creative department needs a raise.</p><p><strong>We love you all.</strong></p>';
  assert.deepEqual(parseShowNotes(html), { quote: '', chapters: [], billing: null, proseHtml: html });
});

test('content outside <p> blocks is kept as prose', () => {
  assert.equal(parseShowNotes('<ul><li>one</li></ul><p>two</p>').proseHtml, '<ul><li>one</li></ul><p>two</p>');
});

test('an empty or missing description parses to nothing', () => {
  const empty = { quote: '', chapters: [], billing: null, proseHtml: '' };
  assert.deepEqual(parseShowNotes(''), empty);
  assert.deepEqual(parseShowNotes(undefined), empty);
});
