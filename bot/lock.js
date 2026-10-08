// One Curator at a time across processes: the daemon and the break-glass CLI
// both edit the same replaceable Curation. An O_EXCL pid file; a lock left by
// a dead process is stale and taken over.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function acquireLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path);
        } catch {
          // Already gone.
        }
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = 0;
      try {
        holder = Number(readFileSync(path, 'utf8'));
      } catch {
        // Vanished between open and read; retry.
      }
      if (holder && holder !== process.pid && isAlive(holder)) {
        throw new Error(`another Curator (pid ${holder}) holds ${path}`);
      }
      try {
        unlinkSync(path);
      } catch {
        // Raced with its release.
      }
    }
  }
  throw new Error(`could not take ${path}`);
}
