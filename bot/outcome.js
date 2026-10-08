// Every Curator run and every intake (bot/intake.js) ends in exactly one
// Outcome, and every reply is renderOutcome(outcome):
//
//   { kind: 'curated', change: 'added' | 'renamed' | 'unchanged', entry, title, url,
//     meta, total, createdAt, previousSlug?, ignoredName? }
//   { kind: 'episode', change: 'created' | 'exists', episodeId, url, title? }   see EPISODE
//   { kind: 'standardized', change: 'standardized' | 'unchanged', dryRun,
//     rows: [{ title, from, to }], published, verified? }   CLI only, see STANDARDIZED
//   { kind: 'refused', reason, ...detail }          see REFUSED
//   { kind: 'failed', step, detail, published, missing? }   see FAILED; published: the new Curation reached a relay
//                                                           (intake steps carry neither published nor missing)
//   { kind: 'unknown', reason, ...detail }          an unparseable request, see UNKNOWN
//   { kind: 'help' }
//
// Each table has one template per variant; a variant without one throws, so
// a new reason or step cannot ship with a silent or generic reply.

export const HELP = [
  'Mention me with a Nostr long-form link (naddr, or an njump / habla / yakihonne / primal link) to make it an Official Essay.',
  '`slug:the-slug` picks the address for a new Essay. `name:"Display Name"` (straight or curly quotes) names an author the site has not credited yet.',
  '`<link> rename slug:new-slug` changes a listed Essay\'s address (the old link keeps working).',
  'Mention me with a Craig recording link (`https://craig.horse/rec/<id>?key=<key>`) to start a podcast Episode from it. Any other text in the message becomes its title.',
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
  renamed: (o) => `Renamed **${o.title}** to \`${o.entry.slug}\`.${o.previousSlug ? ` The old link /essay/${o.previousSlug} still works and lands here.` : ''}\n${o.url}`,
  unchanged: (o) => `**${o.title}** is already listed as \`${o.entry.slug}\`.${o.ignoredName ? ` I ignored \`name:"${o.ignoredName}"\`: a listed Essay's credit doesn't change.` : ''}\n${o.url}`,
};

const EPISODE = {
  created: (o) => `Started a new Episode${o.title ? ` **${o.title}**` : ''} from that Craig recording.\n${o.url}\nIts upload folders will be posted in this channel once Craig's audio is saved.`,
  exists: (o) => `That Craig recording already has an Episode.\n${o.url}`,
};

const REFUSED = {
  'slug-taken': (o) => `Slug \`${o.slug}\` already belongs to another Essay. Mention me again with \`slug:<something-else>\`.`,
  'slug-locked': (o) => `That Essay is already listed as \`${o.slug}\`. To change its address, mention me with \`<link> rename slug:${o.requested}\`.`,
  'author-unnamed': (o) => `The site doesn't credit author \`${o.author.slice(0, 8)}…\` yet. Who should it credit? Mention me again with \`name:"Display Name"\`.`,
  'not-listed': () => 'That Essay is not an Official Essay, so there is nothing to rename. Mention me with just the link to add it.',
  'curations-disagree': (o) => `The relays disagree about the Official Essay list: the newest copy lacks ${o.missing.length} Essay(s) an older copy lists, so publishing could delist them. I changed nothing; try again once the relays catch up.\n${someOf(o.missing)}`,
  'curation-stale': (o) => `The newest Official Essay list I can read (${new Date(o.newest * 1000).toISOString()}) is older than one I have already seen (${new Date(o.floor * 1000).toISOString()}), so the relays are behind. I changed nothing; try again in a minute.`,
  'curation-unreadable': () => 'No relay answered with the current Official Essay list, so I changed nothing (publishing now could delist every Essay). Try again in a minute.',
  'craig-invalid-key': () => 'Craig says that link\'s key is wrong, so nothing was started. Paste the whole link Craig sent, `?key=` included.',
  'craig-no-rec': () => 'Craig has no recording with that id, so nothing was started. Check the link and mention me again.',
  'craig-recording-deleted': () => 'Craig says that recording was deleted, so there is nothing to start an Episode from.',
  'craig-rec-no-data': () => 'Craig says that recording has no audio in it, so nothing was started.',
  'craig-invalid-rec': () => 'Craig says that recording is invalid, so nothing was started.',
  'craig-other': (o) => `Craig refused that recording with \`${o.code}\`, so nothing was started.`,
  'titles-missing': (o) => `I couldn't read the title of ${o.missing.length} Official Essay(s) from any relay or the vault, so I changed nothing:\n${someOf(o.missing)}`,
};

const FAILED = {
  capture: (o) => `Couldn't fetch that Essay from any relay: ${o.detail}\nPaste the naddr instead of a short link, or try again in a minute.`,
  'read-curation': (o) => `The live Official Essay list can't be edited safely, so I changed nothing: ${o.detail}`,
  'presence-gate': (o) => `Nothing was published: ${o.missing.length} Official Essay(s) can't be read back from the brand relays:\n${someOf(o.missing)}`,
  publish: (o) => `Publishing the list failed: ${o.detail}`,
  'save-local': (o) => `The list is live on the relays, but saving my own copy of it failed, so I stopped before writing the Essay Pages: ${o.detail}\nMentioning me again finishes the job.`,
  render: (o) => `The list is live, but writing the Essay Pages failed: ${o.detail}`,
  'verify-html': (o) => `${o.published ? 'The list is live, but the' : 'The'} Essay Page did not serve its own preview: ${o.detail}`,
  craig: () => 'The editor couldn\'t reach Craig to check that recording, so nothing was started. Mention me again in a minute.',
  editor: (o) => `I couldn't reach the podcast editor (${o.detail}), so nothing was started. Mention me again once it and the cspod tunnel are up.`,
  'editor-cert': () => 'The podcast editor\'s certificate doesn\'t match the pinned fingerprint, so I sent it nothing. If its certificate was replaced, update `intake.certSha256` in the bot\'s config.',
  'editor-auth': () => 'The podcast editor refused my intake secret, so nothing was started. The droplet\'s `cspod-intake-secret` credential must match the editor\'s CSPOD_INTAKE_SECRET.',
  'editor-response': (o) => `The podcast editor gave an answer I don't understand (${o.detail}), so I can't say whether an Episode was started.`,
  'intake-off': () => 'Starting Episodes from Craig links isn\'t set up on this bot: it needs `intake` in its config and the `cspod-intake-secret` credential. Essay links still work.',
  internal: (o) => `Something broke (${o.detail}). Mentioning me again is safe; \`journalctl -u cinemaslime-bot\` on the droplet has the details.`,
};

const UNKNOWN = {
  'no-link': () => `I didn't find a Nostr long-form link in that.\n${HELP}`,
  'not-an-essay': () => 'That link is not a long-form Essay (kind 30023).',
  'bad-slug': (o) => `\`${o.slug}\` isn't a valid slug: use lowercase letters, digits and single hyphens.`,
  'bad-name': () => 'I couldn\'t read that name. Write it as `name:"Display Name"`, with one pair of straight or curly quotes around it.',
  'rename-needs-slug': () => 'Rename needs the new address: `<link> rename slug:new-slug`.',
  'craig-needs-key': () => 'That Craig link has no key. Paste the whole link Craig sent, `?key=` included.',
  'two-links': () => 'One link per mention, please. Mention me once for each.',
};

function pick(table, key, outcome) {
  const render = table[key];
  if (!render) throw new Error(`renderOutcome: no template for ${outcome.kind} "${key}"`);
  return render(outcome);
}

// One line per Essay, old slug -> new slug, in display order.
function slugTable(rows) {
  const label = (r) => r.from ?? '(no slug)';
  const width = Math.max(...rows.map((r) => label(r).length));
  return rows
    .map((r) => `${label(r).padEnd(width)} ${r.from === r.to ? '   (unchanged)' : `-> ${r.to}`}`)
    .join('\n');
}

const STANDARDIZED = {
  standardized: (o) => {
    const changed = o.rows.filter((r) => r.from !== r.to).length;
    const head = o.dryRun
      ? `Dry run: ${changed} of ${o.rows.length} Essay Slugs would change. Nothing was published.`
      : `Standardized ${changed} of ${o.rows.length} Essay Slugs. Every old slug is now a Slug Alias; ${o.verified} pages verified.`;
    return `${head}\n${slugTable(o.rows)}`;
  },
  unchanged: (o) => `All ${o.rows.length} Essay Slugs are already standard.${o.dryRun ? '' : ` ${o.verified} pages verified.`}`,
};

// The CLI passes { max: Infinity }: a terminal has no Discord limit.
export function renderOutcome(outcome, { max = REPLY_MAX } = {}) {
  const text = renderUncapped(outcome);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderUncapped(outcome) {
  switch (outcome.kind) {
    // No ✅ here: that mark is reserved for an observed Discord card (card.js).
    case 'curated': return pick(CURATED, outcome.change, outcome);
    case 'episode': return pick(EPISODE, outcome.change, outcome);
    case 'standardized': return pick(STANDARDIZED, outcome.change, outcome);
    case 'refused': return `🚫 ${pick(REFUSED, outcome.reason, outcome)}`;
    case 'failed': return `❌ ${pick(FAILED, outcome.step, outcome)}`;
    case 'unknown': return pick(UNKNOWN, outcome.reason, outcome);
    case 'help': return HELP;
    default: throw new Error(`renderOutcome: unknown outcome kind "${outcome.kind}"`);
  }
}

export const TEMPLATES = { CURATED, EPISODE, STANDARDIZED, REFUSED, FAILED, UNKNOWN };
