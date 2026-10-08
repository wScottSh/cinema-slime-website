// One Curator at a time across processes: the daemon and the break-glass CLI
// both edit the same replaceable Curation. The lock file lives in the
// tmpfs RuntimeDirectory (/run/cinemaslime-bot), so a reboot clears it.
//
// It holds "<pid> <start time>", the start time from /proc/<pid>/stat, so a
// pid the kernel reused for another process does not keep a dead holder's
// lock. Acquiring is link(2) of a private file: atomic, and it fails if any
// lock exists. Only a stale lock is ever removed, and only under an O_EXCL
// takeover guard after re-reading it, so two processes taking over the same
// stale lock cannot both win.
import { randomBytes } from 'node:crypto';
import { closeSync, linkSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

function startTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 22; the command name (field 2) may contain spaces, so count after its ')'.
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}

function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function lockIdentity(pid) {
  return `${pid} ${startTime(pid) ?? '?'}`;
}

function holderAlive(content) {
  const [pidText, start] = content.trim().split(' ');
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    // EPERM: the pid exists under another user. Only the start time can say it is not a Curator.
    if (err.code === 'ESRCH') return false;
  }
  const actual = startTime(pid);
  if (actual === null || start === undefined || start === '?') return true;
  return actual === start;
}

function removeStale(path, stale) {
  const guard = `${path}.takeover`;
  let fd;
  try {
    fd = openSync(guard, 'wx', 0o600);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    throw new Error(`another process is taking over ${path}; if none is, delete ${guard}`);
  }
  try {
    if (readOrNull(path) === stale) unlinkSync(path);
  } finally {
    closeSync(fd);
    unlinkSync(guard);
  }
}

export function acquireLock(path) {
  const me = lockIdentity(process.pid);
  const mine = `${path}.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(mine, me, { mode: 0o600, flag: 'wx' });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(mine, path);
        return () => {
          if (readOrNull(path) === me) unlinkSync(path);
        };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
      const holder = readOrNull(path);
      if (holder === null) continue;
      if (holderAlive(holder)) {
        throw new Error(`another Curator (pid ${holder.split(' ')[0]}) holds ${path}; if it is not running, delete ${path}`);
      }
      removeStale(path, holder);
    }
    throw new Error(`could not take ${path}`);
  } finally {
    unlinkSync(mine);
  }
}
