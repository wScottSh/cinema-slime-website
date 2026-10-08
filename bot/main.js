// cinemaslime-bot: the Cinema Slime Curator (ADR 0021).
//
//   cinemaslime-bot run                                       the Discord daemon (systemd)
//   cinemaslime-bot curate <link> [--slug s] [--name "N"]     break-glass, same Curator
//   cinemaslime-bot rename <link> --slug s
//   cinemaslime-bot standardize [--dry-run]                  every slug to the standard rule (ADR 0022)
//
// Secrets come only from systemd credentials: $CREDENTIALS_DIRECTORY/
// {discord-token, brand-secret-key}. Paths are overridable for local runs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { getPublicKey } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { BRAND_PUBKEY } from '../src/brand.js';
import { buildCommand } from '../src/curation-command.js';
import { createRelayPort } from '../src/relay-port.js';
import { createFileVaultStore } from '../src/vault-store.js';
import { createCurator } from './curator.js';
import { createMentionHandler, replayPending } from './daemon.js';
import { connectDiscord } from './discord.js';
import { createJournal } from './journal.js';
import { renderOutcome } from './outcome.js';

const USAGE = `Usage:
  cinemaslime-bot run
  cinemaslime-bot curate <nostr link> [--slug <slug>] [--name "<Display Name>"]
  cinemaslime-bot rename <nostr link> --slug <slug>
  cinemaslime-bot standardize [--dry-run]

Secrets: $CREDENTIALS_DIRECTORY/discord-token (run only) and brand-secret-key.
Paths:   CINEMASLIME_BOT_STATE (default /var/lib/cinemaslime-bot),
         $RUNTIME_DIRECTORY or CINEMASLIME_BOT_RUNTIME (default /run/cinemaslime-bot; the lock),
         CINEMASLIME_WEBROOT (default /var/www/cinemaslime/html),
         CINEMASLIME_BOT_CONFIG (default /opt/cinemaslime-bot/config.json).
The CLI refuses while the daemon holds the Curator lock: stop it first
(systemctl stop cinemaslime-bot).`;

const STATE_DIR = process.env.CINEMASLIME_BOT_STATE ?? '/var/lib/cinemaslime-bot';
const RUNTIME_DIR = process.env.RUNTIME_DIRECTORY ?? process.env.CINEMASLIME_BOT_RUNTIME ?? '/run/cinemaslime-bot';
const WEBROOT = process.env.CINEMASLIME_WEBROOT ?? '/var/www/cinemaslime/html';
const CONFIG = process.env.CINEMASLIME_BOT_CONFIG ?? '/opt/cinemaslime-bot/config.json';

const DRAIN_MS = 60_000;

const log = (line) => console.log(line);

function readCredential(name) {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (!dir) throw new Error('CREDENTIALS_DIRECTORY is not set; run under systemd with LoadCredential=');
  return readFileSync(join(dir, name), 'utf8').trim();
}

// Refuse to start with any key but the brand's: a Curation signed by another
// key is ignored by the site, so publishing it would silently do nothing.
function readBrandKey() {
  const hex = readCredential('brand-secret-key');
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('brand-secret-key is not 64 hex characters');
  const secretKey = Uint8Array.from(Buffer.from(hex, 'hex'));
  if (getPublicKey(secretKey) !== BRAND_PUBKEY) throw new Error('brand-secret-key does not belong to BRAND_PUBKEY');
  return secretKey;
}

function readConfig() {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (typeof config.guildId !== 'string' || typeof config.channelId !== 'string' || !Array.isArray(config.allowedUserIds)) {
    throw new Error(`${CONFIG} needs { guildId, channelId, allowedUserIds: [] }`);
  }
  return config;
}

function makeCurator() {
  const pool = new SimplePool();
  const curator = createCurator({
    relayPort: createRelayPort(pool),
    store: createFileVaultStore(join(STATE_DIR, 'vault', 'essays')),
    secretKey: readBrandKey(),
    stateDir: STATE_DIR,
    runtimeDir: RUNTIME_DIR,
    webroot: WEBROOT,
    log,
  });
  return { curator, pool };
}

async function runDaemon() {
  const config = readConfig();
  const token = readCredential('discord-token');
  const { curator } = makeCurator();
  const journal = createJournal(join(STATE_DIR, 'journal'));
  let handle = null;
  const early = [];
  const dispatch = (mention) => handle(mention).catch((err) => log(`mention ${mention.messageId} failed: ${err.stack}`));
  const discord = await connectDiscord({
    token,
    config,
    onMention: (mention) => (handle ? dispatch(mention) : early.push(mention)),
    log,
  });
  handle = createMentionHandler({ curator, discord, journal, log });
  early.forEach(dispatch);

  replayPending({ journal, discord, dispatch, log }).catch((err) => log(`replay failed: ${err.stack}`));

  // systemd's TimeoutStopSec (90 s) must outlast this drain.
  const stop = async () => {
    log(`stopping: waiting up to ${DRAIN_MS / 1000}s for in-flight mentions`);
    const drained = await Promise.race([handle.close().then(() => true), delay(DRAIN_MS).then(() => false)]);
    if (!drained) log('drain timed out; unsettled mentions replay on the next start');
    await discord.close();
    curator.close();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

async function runOnce(verb, positionals, values) {
  const command = buildCommand({ verb, input: positionals[0], slug: values.slug, name: values.name, dryRun: values['dry-run'] });
  const { curator, pool } = makeCurator();
  try {
    const outcome = await curator.run(command);
    console.log(renderOutcome(outcome, { max: Infinity }));
    return outcome.kind === 'curated' || outcome.kind === 'standardized' ? 0 : 1;
  } finally {
    curator.close();
    pool.destroy();
  }
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { slug: { type: 'string' }, name: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  const [verb, ...rest] = positionals;
  if (values.help || !verb || verb === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (verb === 'run') {
    await runDaemon();
    return null;
  }
  if (verb === 'curate' || verb === 'rename' || verb === 'standardize') return runOnce(verb, rest, values);
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => { if (code !== null) process.exit(code); },
  (err) => { console.error(err.message); process.exit(1); },
);
