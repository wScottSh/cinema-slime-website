// Every Curator run ends in exactly one Outcome, and every reply is
// renderOutcome(outcome):
//
//   { kind: 'curated', change: 'added' | 'renamed' | 'unchanged', entry, title, url,
//     meta, total, createdAt, previousSlug? }
//   { kind: 'refused', reason, ...detail }          see REFUSED
//   { kind: 'failed', step, detail, published }     see FAILED
//   { kind: 'unknown', reason, ...detail }          an unparseable request, see UNKNOWN
//   { kind: 'help' }
//
// Each table has one template per variant; a variant without one throws, so
// a new reason or step cannot ship with a silent or generic reply.

export const HELP = [
  'Mention me with a Nostr long-form link (naddr, or an njump / habla / yakihonne / primal link) to make it an Official Essay.',
  '`slug:the-slug` picks the address for a new Essay. `name:"Display Name"` names an author the site has not credited yet.',
  '`<link> rename slug:new-slug` changes a listed Essay\'s address (the old link stops working).',
].join('\n');

const CURATED = {
  added: (o) => `Added **${o.title}** as Official Essay #${o.total}.\n${o.url}`,
  renamed: (o) => `Renamed **${o.title}** to \`${o.entry.slug}\`. The old link /essay/${o.previousSlug} no longer works; the coordinate link still does.\n${o.url}`,
  unchanged: (o) => `**${o.title}** is already listed as \`${o.entry.slug}\`.\n${o.url}`,
};

const REFUSED = {
  'slug-taken': (o) => `Slug \`${o.slug}\` already belongs to another Essay. Mention me again with \`slug:<something-else>\`.`,
  'slug-locked': (o) => `That Essay is already listed as \`${o.slug}\`. To change its address, mention me with \`<link> rename slug:${o.requested}\`.`,
  'author-unnamed': (o) => `The site doesn't credit author \`${o.author.slice(0, 8)}…\` yet. Who should it credit? Mention me again with \`name:"Display Name"\`.`,
  'not-listed': () => 'That Essay is not an Official Essay, so there is nothing to rename. Mention me with just the link to add it.',
  'curation-unreadable': () => 'No relay answered with the current Official Essay list, so I changed nothing (publishing now could delist every Essay). Try again in a minute.',
};

const FAILED = {
  capture: (o) => `Couldn't fetch that Essay from any relay: ${o.detail}\nPaste the naddr instead of a short link, or try again in a minute.`,
  'read-curation': (o) => `The live Official Essay list can't be edited safely, so I changed nothing: ${o.detail}`,
  'presence-gate': (o) => `Nothing was published: these Official Essays can't be read back from the brand relays:\n${o.detail}`,
  publish: (o) => `Publishing the list failed: ${o.detail}`,
  render: (o) => `The list is live, but writing the Essay Pages failed: ${o.detail}`,
  'verify-html': (o) => `${o.published ? 'The list is live, but the' : 'The'} Essay Page did not serve its own preview: ${o.detail}`,
  internal: (o) => `Something broke (${o.detail}). Mentioning me again is safe; \`journalctl -u cinemaslime-bot\` on the droplet has the details.`,
};

const UNKNOWN = {
  'no-link': () => `I didn't find a Nostr long-form link in that.\n${HELP}`,
  'not-an-essay': () => 'That link is not a long-form Essay (kind 30023).',
  'bad-slug': (o) => `\`${o.slug}\` isn't a valid slug: use lowercase letters, digits and single hyphens.`,
  'rename-needs-slug': () => 'Rename needs the new address: `<link> rename slug:new-slug`.',
};

function pick(table, key, outcome) {
  const render = table[key];
  if (!render) throw new Error(`renderOutcome: no template for ${outcome.kind} "${key}"`);
  return render(outcome);
}

export function renderOutcome(outcome) {
  switch (outcome.kind) {
    // No ✅ here: that mark is reserved for an observed Discord card (card.js).
    case 'curated': return pick(CURATED, outcome.change, outcome);
    case 'refused': return `🚫 ${pick(REFUSED, outcome.reason, outcome)}`;
    case 'failed': return `❌ ${pick(FAILED, outcome.step, outcome)}`;
    case 'unknown': return pick(UNKNOWN, outcome.reason, outcome);
    case 'help': return HELP;
    default: throw new Error(`renderOutcome: unknown outcome kind "${outcome.kind}"`);
  }
}

export const TEMPLATES = { CURATED, REFUSED, FAILED, UNKNOWN };
