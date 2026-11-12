// The newsletter signup strip on the Discovery View (ADR 0024).
//
// One state value, advanced by a pure reducer over events, rendered by a pure
// builder. main.js owns the only side effects: the fetch, the localStorage flag,
// and patching the strip's container.
//
//   state  { status: 'idle' | 'submitting' | 'subscribed' | 'failed',
//            email: string,
//            problem?: 'invalid' | 'rate-limited' | 'unavailable' }  (failed only)
//   events { type: 'typed', email } | { type: 'submitted' }
//          | { type: 'accepted' } | { type: 'rejected', problem }
//
// Pure: no DOM, no network, no storage.

// The edge's own check, character for character: nginx refuses anything else
// with 422 before calling Sender (deploy/nginx/cinemaslime-newsletter-location.conf).
// The alphabet is what keeps the address safe to paste into the JSON body nginx
// builds, so it is narrower than RFC 5321 on purpose. newsletter.test.js fails
// if this and the nginx regex drift apart.
export const EMAIL_PATTERN = /^(?=.{1,254}$)[A-Za-z0-9._+'-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;

export const NEWSLETTER_PATH = '/api/newsletter';

// A flag, never the address: whoever uses this browser next should not learn it.
export const NEWSLETTER_STORAGE_KEY = 'cs-newsletter-subscribed';

export const PROBLEM_MESSAGES = Object.freeze({
  invalid: "That address won't take. Check it and try again.",
  'rate-limited': 'Too many tries. Give it a minute, then go again.',
  unavailable: "The mail room's jammed. Try again in a bit.",
});

export const SUBSCRIBED_MESSAGE = "You're on the list. Watch your inbox for the slime.";

// What the edge's answer means. Anything not listed, and a request that never
// got an answer, is 'unavailable'.
const STATUS_EVENTS = Object.freeze({
  204: { type: 'accepted' },
  422: { type: 'rejected', problem: 'invalid' },
  429: { type: 'rejected', problem: 'rate-limited' },
});
const UNAVAILABLE = Object.freeze({ type: 'rejected', problem: 'unavailable' });

export function eventForStatus(status) {
  return STATUS_EVENTS[status] || UNAVAILABLE;
}

export function eventForNetworkError() {
  return UNAVAILABLE;
}

export function isValidEmail(email) {
  return EMAIL_PATTERN.test(email);
}

export function initialNewsletterState({ subscribed = false } = {}) {
  return subscribed ? { status: 'subscribed', email: '' } : { status: 'idle', email: '' };
}

export function newsletterReducer(state, event) {
  switch (event.type) {
    case 'typed':
      if (state.status === 'idle') return { status: 'idle', email: event.email };
      if (state.status === 'failed') return { ...state, email: event.email };
      return state;
    case 'submitted': {
      if (state.status !== 'idle' && state.status !== 'failed') return state;
      const email = state.email.trim();
      if (!isValidEmail(email)) return { status: 'failed', email: state.email, problem: 'invalid' };
      return { status: 'submitting', email };
    }
    case 'accepted':
      return state.status === 'submitting' ? { status: 'subscribed', email: '' } : state;
    case 'rejected':
      return state.status === 'submitting' ? { status: 'failed', email: state.email, problem: event.problem } : state;
    default:
      return state;
  }
}

/** The one request a submit makes. The address rides in a header; see ADR 0024. */
export function describeNewsletterRequest(email) {
  return {
    url: NEWSLETTER_PATH,
    init: { method: 'POST', headers: { 'X-Newsletter-Email': email } },
  };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function newsletterMessage(state) {
  if (state.status === 'subscribed') return SUBSCRIBED_MESSAGE;
  if (state.status === 'failed') return PROBLEM_MESSAGES[state.problem] || PROBLEM_MESSAGES.unavailable;
  return '';
}

export function newsletterStatusClass(state) {
  return `newsletter-status newsletter-status--${state.status}`;
}

/**
 * The form, or nothing once subscribed. Patched on its own on every status
 * change, so the status line beside it (a live region) stays in the document
 * and is announced when its text changes.
 */
export function buildNewsletterActHtml(state) {
  if (state.status === 'subscribed') return '';
  const submitting = state.status === 'submitting';
  const invalid = state.status === 'failed' && state.problem === 'invalid';
  return `<form class="newsletter-form" id="newsletter-form" novalidate>
      <label class="newsletter-label" for="newsletter-email">Email address</label>
      <input type="email" id="newsletter-email" name="email" autocomplete="email" inputmode="email"
        placeholder="you@example.com" value="${escapeHtml(state.email)}"${submitting ? ' readonly' : ''}${invalid ? ' aria-invalid="true"' : ''}
        aria-describedby="newsletter-status" />
      <button type="submit" class="btn btn-primary"${submitting ? ' disabled' : ''}>${submitting ? 'Sending…' : 'Sign me up'}</button>
    </form>`;
}

export function buildNewsletterHtml(state) {
  return `<section class="newsletter" aria-labelledby="newsletter-heading">
    <div class="newsletter-pitch">
      <p class="hero-stencil hero-stencil--sm">The Newsletter</p>
      <h2 class="newsletter-line" id="newsletter-heading">Every new episode and essay, mailed to you.</h2>
    </div>
    <div class="newsletter-act" id="newsletter-act">${buildNewsletterActHtml(state)}</div>
    <p class="${newsletterStatusClass(state)}" id="newsletter-status" role="status" aria-live="polite" tabindex="-1">${escapeHtml(newsletterMessage(state))}</p>
  </section>`;
}
