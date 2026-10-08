// What the daemon does with one accepted mention: 👀 at once, run the
// Curator, then exactly one reply, then (for a curated Essay) watch Discord
// build that reply's card. The journal makes a redelivered or crashed message
// converge instead of repeating.
import { parseMention } from '../src/curation-command.js';
import { verifyDiscordCard } from './card.js';
import { MAX_REPLAY_AGE_MS } from './journal.js';
import { renderOutcome } from './outcome.js';

export function createMentionHandler({ curator, discord, journal, log = () => {} }) {
  return async function handleMention(mention) {
    const entry = journal.get(mention.messageId);
    if (journal.isSettled(mention.messageId)) return;
    if (entry?.replyId) {
      journal.finish(mention, entry.outcome);
      return;
    }
    journal.begin(mention);
    const command = parseMention(mention.content, discord.botUserId, discord.botRoleId);
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
    journal.replied(mention, reply.id, outcome.kind);
    try {
      if (outcome.kind === 'curated') log(`${mention.messageId} card: ${await verifyDiscordCard(reply, outcome)}`);
    } catch (err) {
      log(`${mention.messageId} card check failed: ${err.message}`);
    } finally {
      journal.finish(mention, outcome.kind);
    }
  };
}

// On boot, every entry a crash left unsettled. `dispatch(mention)` runs the
// handler; entries that already replied settle without it.
export async function replayPending({ journal, discord, dispatch, nowMs = Date.now(), log = () => {} }) {
  for (const entry of journal.pending()) {
    if (entry.replyId) {
      journal.finish(entry, entry.outcome);
      continue;
    }
    if (!(nowMs - entry.startedAt < MAX_REPLAY_AGE_MS)) {
      journal.abandon(entry, 'older than 24h');
      log(`abandoned ${entry.messageId}: older than 24h`);
      continue;
    }
    let mention;
    try {
      mention = await discord.fetchMention(entry.channelId, entry.messageId);
    } catch (err) {
      journal.abandon(entry, `message not fetchable: ${err.message}`);
      log(`abandoned ${entry.messageId}: ${err.message}`);
      continue;
    }
    log(`replaying ${entry.messageId} after a restart`);
    dispatch(mention);
  }
}
