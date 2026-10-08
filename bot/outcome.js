// Every Curator run ends in exactly one Outcome, and every reply is
// renderOutcome(outcome):
//
//   { kind: 'curated', change: 'added' | 'renamed' | 'unchanged', entry, title, url,
//     meta, total, createdAt, previousSlug?, ignoredName? }
//   { kind: 'refused', reason, ...detail }          see REFUSED
//   { kind: 'failed', step, detail, published, missing? }   see FAILED; published: the new Curation reached a relay
//   { kind: 'unknown', reason, ...detail }          an unparseable request, see UNKNOWN
//   { kind: 'help' }
//
// Each table has one template per variant; a variant without one throws, so
// a new reason or step cannot ship with a silent or generic reply.

export const HELP = [
  'Mention me with a Nostr long-form link (naddr, or an njump / habla / yakihonne / primal link) to make it an Official Essay.',
  '`slug:the-slug` picks the address for a new Essay. `name:"Display Name"` (straight or curly quotes) names an author the site has not credited yet.',
  '`<link> rename slug:new-slug` changes a listed Essay\'s address (the old link stops working).',
].join('\n');

// Discord rejects a message over 2000 characters. card.js later appends a
// line of up to ~120, so a reply is cut well under the limit.
export const REPLY_MAX = 1800;
const LIST_SHOWN = 5;

function someOf(items) {
  const shown = items.slice(0, LIST_SHOWN).join('\n');
  return items.length > LIST_SHOWN ? `${shown}\n…and ${items.length - LIST_SHOWN} more` : shown;
}

const CURATED = {
  added: (o) => `Added **${o.title}** as Official Essay #${o.total}.\n${o.url}`,
  renamed: (o) => `Renamed **${o.title}** to \`${o.entry.slug}\`. The old link /essay/${o.previousSlug} no longer works; the coordinate link still does.\n${o.url}`,
  unchanged: (o) => `**${o.title}** is already listed as \`${o.entry.slug}\`.${o.ignoredName ? ` I ignored \`name:"${o.ignoredName}"\`: a listed Essay's credit doesn't change.` : ''}\n${o.url}`,
};

const REFUSED = {
  'slug-taken': (o) => `Slug \`${o.slug}\` already belongs to another Essay. Mention me again with \`slug:<something-else>\`.`,
  'slug-locked': (o) => `That Essay is already listed as \`${o.slug}\`. To change its address, mention me with \`<link> rename slug:${o.requested}\`.`,
  'author-unnamed': (o) => `The site doesn't credit author \`${o.author.slice(0, 8)}…\` yet. Who should it credit? Mention me again with \`name:"Display Name"\`.`,
  'not-listed': () => 'That Essay is not an Official Essay, so there is nothing to rename. Mention me with just the link to add it.',
  'curations-disagree': (o) => `The relays disagree about the Official Essay list: the newest copy lacks ${o.missing.length} Essay(s) an older copy lists, so publishing could delist them. I changed nothing; try again once the relays catch up.\n${someOf(o.missing)}`,
  'curation-stale': (o) => `The newest Official Essay list I can read (${new Date(o.newest * 1000).toISOString()}) is older than one I have already seen (${new Date(o.floor * 1000).toISOString()}), so the relays are behind. I changed nothing; try again in a minute.`,
  'curation-unreadable': () => 'No relay answered with the current Official Essay list, so I changed nothing (publishing now could delist every Essay). Try again in a minute.',
};

const FAILED = {
  capture: (o) => `Couldn't fetch that Essay from any relay: ${o.detail}\nPaste the naddr instead of a short link, or try again in a minute.`,
  'read-curation': (o) => `The live Official Essay list can't be edited safely, so I changed nothing: ${o.detail}`,
  'presence-gate': (o) => `Nothing was published: ${o.missing.length} Official Essay(s) can't be read back from the brand relays:\n${someOf(o.missing)}`,
  publish: (o) => `Publishing the list failed: ${o.detail}`,
  'save-local': (o) => `The list is live on the relays, but saving my own copy of it failed, so I stopped before writing the Essay Pages: ${o.detail}\nMentioning me again finishes the job.`,
  render: (o) => `The list is live, but writing the Essay Pages failed: ${o.detail}`,
  'verify-html': (o) => `${o.published ? 'The list is live, but the' : 'The'} Essay Page did not serve its own preview: ${o.detail}`,
  internal: (o) => `Something broke (${o.detail}). Mentioning me again is safe; \`journalctl -u cinemaslime-bot\` on the droplet has the details.`,
};

const UNKNOWN = {
  'no-link': () => `I didn't find a Nostr long-form link in that.\n${HELP}`,
  'not-an-essay': () => 'That link is not a long-form Essay (kind 30023).',
  'bad-slug': (o) => `\`${o.slug}\` isn't a valid slug: use lowercase letters, digits and single hyphens.`,
  'bad-name': () => 'I couldn\'t read that name. Write it as `name:"Display Name"`, with one pair of straight or curly quotes around it.',
  'rename-needs-slug': () => 'Rename needs the new address: `<link> rename slug:new-slug`.',
};

function pick(table, key, outcome) {
  const render = table[key];
  if (!render) throw new Error(`renderOutcome: no template for ${outcome.kind} "${key}"`);
  return render(outcome);
}

export function renderOutcome(outcome) {
  const text = renderUncapped(outcome);
  return text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX - 1)}…` : text;
}

function renderUncapped(outcome) {
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
