// One file per Discord message the daemon accepted:
//
//   { messageId, channelId, startedAt, state, replyId?, outcome?, reason? }
//
//   started    the Curator may be running; no reply posted yet
//   replied    the reply (replyId) is posted; only card verification remains
//   done       settled
//   abandoned  settled without a reply: the message vanished, or the entry
//              outlived MAX_REPLAY_AGE_MS
//
// A Gateway RESUME can redeliver a message: a settled entry skips it. A crash
// leaves started or replied, and the daemon replays those on boot. A replay
// never posts a second reply once one is recorded, and every Curator step
// converges, so a re-run never double-publishes.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_REPLAY_AGE_MS = 24 * 60 * 60 * 1000;
const SETTLED = new Set(['done', 'abandoned']);

export function createJournal(dir, { nowMs = Date.now } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = (messageId) => join(dir, `${messageId}.json`);
  const get = (messageId) => {
    try {
      return JSON.parse(readFileSync(file(messageId), 'utf8'));
    } catch {
      return null;
    }
  };
  const update = ({ messageId, channelId }, patch) => {
    const entry = { ...get(messageId), messageId, channelId, ...patch };
    const tmp = `${file(messageId)}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, file(messageId));
  };
  return {
    get,
    isSettled: (messageId) => SETTLED.has(get(messageId)?.state),
    begin: (mention) => update(mention, { state: 'started', startedAt: get(mention.messageId)?.startedAt ?? nowMs() }),
    replied: (mention, replyId, outcome) => update(mention, { state: 'replied', replyId, outcome }),
    finish: (mention, outcome) => update(mention, { state: 'done', outcome }),
    abandon: (mention, reason) => update(mention, { state: 'abandoned', reason }),
    pending: () => readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => get(name.slice(0, -'.json'.length)))
      .filter((entry) => entry && !SETTLED.has(entry.state)),
  };
}
