// What the daemon does with one accepted mention: 👀 at once, run the
// Curator, then exactly one reply, then (for a curated Essay) watch Discord
// build that reply's card. The journal makes a redelivered or crashed message
// converge instead of repeating.
import { parseMention } from '../src/curation-command.js';
import { verifyDiscordCard } from './card.js';
import { renderOutcome } from './outcome.js';

export function createMentionHandler({ curator, discord, journal, log = () => {} }) {
  return async function handleMention(mention) {
    if (journal.isDone(mention.messageId)) return;
    journal.begin(mention);
    const command = parseMention(mention.content, discord.botUserId);
    log(`${mention.messageId} from ${mention.authorId}: ${command.kind}`);
    try {
      await discord.react(mention, '👀');
    } catch (err) {
      log(`react failed: ${err.message}`);
    }
    let outcome;
    try {
      outcome = await curator.run(command);
    } catch (err) {
      log(`curator threw: ${err.stack}`);
      outcome = { kind: 'failed', step: 'internal', detail: err.message, published: false };
    }
    const reply = await discord.reply(mention, renderOutcome(outcome));
    if (outcome.kind === 'curated') {
      log(`${mention.messageId} card: ${await verifyDiscordCard(reply, outcome)}`);
    }
    journal.finish(mention, outcome.kind);
  };
}
