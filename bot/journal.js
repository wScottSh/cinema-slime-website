// One file per Discord message the daemon accepted:
//
//   { messageId, channelId, state: 'started' | 'done', outcome? }
//
// A Gateway RESUME can redeliver a message: `done` skips it. A crash mid-run
// leaves `started`, and the daemon re-runs those on boot; every Curator step
// converges, so a re-run never double-publishes.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createJournal(dir) {
  mkdirSync(dir, { recursive: true });
  const file = (messageId) => join(dir, `${messageId}.json`);
  const read = (messageId) => {
    try {
      return JSON.parse(readFileSync(file(messageId), 'utf8'));
    } catch {
      return null;
    }
  };
  const write = (entry) => {
    const tmp = `${file(entry.messageId)}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, file(entry.messageId));
  };
  return {
    isDone: (messageId) => read(messageId)?.state === 'done',
    begin: ({ messageId, channelId }) => write({ messageId, channelId, state: 'started' }),
    finish: ({ messageId, channelId }, outcome) => write({ messageId, channelId, state: 'done', outcome }),
    pending: () => readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => read(name.slice(0, -'.json'.length)))
      .filter((entry) => entry?.state === 'started'),
  };
}
