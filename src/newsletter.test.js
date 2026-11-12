import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMAIL_PATTERN,
  NEWSLETTER_PATH,
  PROBLEM_MESSAGES,
  SUBSCRIBED_MESSAGE,
  buildNewsletterHtml,
  describeNewsletterRequest,
  eventForNetworkError,
  eventForStatus,
  initialNewsletterState,
  isValidEmail,
  newsletterReducer,
} from './newsletter.js';

const run = (events, state = initialNewsletterState()) => events.reduce(newsletterReducer, state);
const typed = (email) => ({ type: 'typed', email });
const SUBMITTED = { type: 'submitted' };

// ── one source of truth with the edge ────────────────────────────────────────

test('the client email check is the nginx regex, character for character', () => {
  const conf = readFileSync(new URL('../deploy/nginx/cinemaslime-newsletter-location.conf', import.meta.url), 'utf8');
  const m = conf.match(/if \(\$http_x_newsletter_email !~ "([^"]+)"\)/);
  assert.ok(m, 'the nginx conf no longer validates X-Newsletter-Email with an `if … !~ "…"` regex');
  assert.equal(m[1], EMAIL_PATTERN.source);
});

test('the request goes to the path nginx serves', () => {
  const conf = readFileSync(new URL('../deploy/nginx/cinemaslime-newsletter-location.conf', import.meta.url), 'utf8');
  assert.ok(conf.includes(`location = ${NEWSLETTER_PATH} {`));
});

test('the email check refuses every character that could break out of a JSON string', () => {
  for (const bad of ['a"b@x.co', 'a\\b@x.co', 'a b@x.co', 'a\nb@x.co', 'a\tb@x.co', 'x@x.co","groups":["y', 'a\u0000@x.co']) {
    assert.equal(isValidEmail(bad), false, JSON.stringify(bad));
  }
});

test('the email check takes ordinary addresses, including plus tags and apostrophes', () => {
  for (const ok of ['slime@example.com', 'first.last+news@sub.example.co.uk', "o'brien@example.ie"]) {
    assert.equal(isValidEmail(ok), true, ok);
  }
});

test('the email check caps the address at 254 characters', () => {
  const at254 = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
  assert.equal(at254.length, 254);
  assert.equal(isValidEmail(at254), true);
  assert.equal(isValidEmail(`${at254.slice(0, -1)}dd`), false);
});

// ── the status table ─────────────────────────────────────────────────────────

test('each edge answer maps to its outcome, and everything else is unavailable', () => {
  assert.deepEqual(eventForStatus(204), { type: 'accepted' });
  assert.deepEqual(eventForStatus(422), { type: 'rejected', problem: 'invalid' });
  assert.deepEqual(eventForStatus(429), { type: 'rejected', problem: 'rate-limited' });
  for (const status of [200, 201, 400, 404, 405, 500, 502, 503, 504]) {
    assert.deepEqual(eventForStatus(status), { type: 'rejected', problem: 'unavailable' }, `status ${status}`);
  }
  assert.deepEqual(eventForNetworkError(), { type: 'rejected', problem: 'unavailable' });
});

test('the request carries the address in the header and nothing in a body', () => {
  const { url, init } = describeNewsletterRequest('slime@example.com');
  assert.equal(url, '/api/newsletter');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { 'X-Newsletter-Email': 'slime@example.com' });
  assert.equal(init.body, undefined);
});

// ── the reducer ──────────────────────────────────────────────────────────────

test('a valid address submits, trimmed', () => {
  assert.deepEqual(run([typed('  slime@example.com '), SUBMITTED]), { status: 'submitting', email: 'slime@example.com' });
});

test('an invalid address fails as invalid without submitting', () => {
  assert.deepEqual(run([typed('slime@'), SUBMITTED]), { status: 'failed', email: 'slime@', problem: 'invalid' });
});

test('a second submit while submitting is ignored', () => {
  const submitting = run([typed('slime@example.com'), SUBMITTED]);
  assert.equal(newsletterReducer(submitting, SUBMITTED), submitting);
});

test('typing while submitting does not change the address in flight', () => {
  const submitting = run([typed('slime@example.com'), SUBMITTED]);
  assert.equal(newsletterReducer(submitting, typed('other@example.com')), submitting);
});

test('accepted subscribes and forgets the address', () => {
  assert.deepEqual(run([typed('slime@example.com'), SUBMITTED, { type: 'accepted' }]), { status: 'subscribed', email: '' });
});

test('each rejection fails with its own problem and keeps the address for a retry', () => {
  for (const problem of ['invalid', 'rate-limited', 'unavailable']) {
    assert.deepEqual(run([typed('slime@example.com'), SUBMITTED, { type: 'rejected', problem }]),
      { status: 'failed', email: 'slime@example.com', problem });
  }
});

test('a failed signup can be retried', () => {
  const failed = run([typed('slime@example.com'), SUBMITTED, { type: 'rejected', problem: 'unavailable' }]);
  assert.deepEqual(newsletterReducer(failed, SUBMITTED), { status: 'submitting', email: 'slime@example.com' });
});

test('a late answer for a request that is no longer in flight changes nothing', () => {
  const idle = run([typed('slime@example.com')]);
  assert.equal(newsletterReducer(idle, { type: 'accepted' }), idle);
  const subscribed = initialNewsletterState({ subscribed: true });
  assert.equal(newsletterReducer(subscribed, { type: 'rejected', problem: 'unavailable' }), subscribed);
  assert.equal(newsletterReducer(subscribed, SUBMITTED), subscribed);
});

test('a remembered subscriber starts subscribed', () => {
  assert.equal(initialNewsletterState({ subscribed: true }).status, 'subscribed');
  assert.equal(initialNewsletterState().status, 'idle');
});

// ── the strip ────────────────────────────────────────────────────────────────

test('the typed address is escaped into the input', () => {
  const html = buildNewsletterHtml(run([typed('"><img src=x onerror=alert(1)>')]));
  assert.ok(!html.includes('<img src=x'), html);
  assert.ok(html.includes('value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
});

test('the form is gone once subscribed, replaced by the confirmation', () => {
  const html = buildNewsletterHtml(initialNewsletterState({ subscribed: true }));
  assert.ok(!html.includes('<form'));
  assert.ok(!html.includes('<input'));
  assert.ok(html.includes(SUBSCRIBED_MESSAGE.replace("'", '&#39;')));
});

test('each problem shows its own message in the status line', () => {
  const seen = new Set();
  for (const problem of ['invalid', 'rate-limited', 'unavailable']) {
    const html = buildNewsletterHtml({ status: 'failed', email: 'slime@example.com', problem });
    const status = html.match(/<p [^>]*role="status"[^>]*>([^<]*)<\/p>/);
    assert.ok(status, 'no status line');
    assert.equal(status[1], PROBLEM_MESSAGES[problem].replace(/'/g, '&#39;'));
    seen.add(status[1]);
  }
  assert.equal(seen.size, 3);
});

test('while submitting the button is disabled and relabeled, and the input cannot change', () => {
  const html = buildNewsletterHtml(run([typed('slime@example.com'), SUBMITTED]));
  assert.match(html, /<button type="submit"[^>]* disabled>Sending…<\/button>/);
  assert.match(html, /<input[^>]* readonly/);
});

test('idle shows an empty status line and an enabled button', () => {
  const html = buildNewsletterHtml(initialNewsletterState());
  assert.match(html, /role="status" aria-live="polite"[^>]*><\/p>/);
  assert.match(html, /<button type="submit" class="btn btn-primary">Sign me up<\/button>/);
});

test('the form opts out of browser validation and labels its input', () => {
  const html = buildNewsletterHtml(initialNewsletterState());
  assert.match(html, /<form[^>]* novalidate>/);
  assert.match(html, /<label [^>]*for="newsletter-email"/);
  assert.match(html, /id="newsletter-email"/);
  for (const attr of ['type="email"', 'autocomplete="email"', 'inputmode="email"']) assert.ok(html.includes(attr), attr);
});

test('only an invalid address marks the input invalid', () => {
  assert.ok(buildNewsletterHtml({ status: 'failed', email: 'x', problem: 'invalid' }).includes('aria-invalid="true"'));
  assert.ok(!buildNewsletterHtml({ status: 'failed', email: 'x@y.co', problem: 'unavailable' }).includes('aria-invalid'));
});
