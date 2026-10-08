// The Discord Gateway adapter: the only module that sees discord.js types.
// Incoming messages become Mentions; outgoing replies are { id, text, edit,
// waitForCard }. The Curator never learns Discord exists.
//
//   Mention: { messageId, channelId, guildId, authorId, authorIsBot, content, mentionsBot }
//   Card:    { title, url }   embeds[0] of a MESSAGE_UPDATE for one of our replies
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { botMentionTokens } from '../src/curation-command.js';

const RECENT_CARDS = 50;

// Pure. Only an explicit user mention of the bot, by a human, in the
// configured channel. An empty allowlist admits anyone who can post there
// (the channel itself is private).
export function isAuthorized(mention, config) {
  return mention.guildId === config.guildId
    && mention.channelId === config.channelId
    && !mention.authorIsBot
    && mention.mentionsBot
    && (config.allowedUserIds.length === 0 || config.allowedUserIds.includes(mention.authorId));
}

function toMention(message, botUserId, botRoleId) {
  return {
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    content: message.content,
    // A reply that pings the bot is not a request; only a written <@bot> or <@&its role> is.
    mentionsBot: botMentionTokens(botUserId, botRoleId).some((token) => message.content.includes(token)),
  };
}

const cardOf = (embeds) => (embeds?.[0] ? { title: embeds[0].title ?? null, url: embeds[0].url ?? null } : null);

export async function connectDiscord({ token, config, onMention, log = () => {} }) {
  // Mentions of the bot carry their content without the privileged
  // MessageContent intent, and so do the bot's own messages.
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  // Latest card per recent reply, plus who is waiting on it. Recorded from the
  // raw Gateway packet so an unfurl that lands before send() returns is kept.
  const cards = new Map();
  const waiters = new Set();
  client.on('raw', (packet) => {
    if (packet.t !== 'MESSAGE_UPDATE' || !packet.d?.embeds) return;
    const card = cardOf(packet.d.embeds);
    if (!card) return;
    cards.set(packet.d.id, card);
    if (cards.size > RECENT_CARDS) cards.delete(cards.keys().next().value);
    for (const waiter of waiters) waiter(packet.d.id, card);
  });

  let botRoleId = null;
  client.on(Events.MessageCreate, (message) => {
    const mention = toMention(message, client.user.id, botRoleId);
    if (!isAuthorized(mention, config)) return;
    onMention(mention);
  });
  client.on(Events.Error, (err) => log(`discord error: ${err.message}`));
  client.on(Events.ShardDisconnect, () => log('gateway disconnected; discord.js will resume'));

  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(token);
  await ready;
  try {
    botRoleId = (await (await client.guilds.fetch(config.guildId)).members.fetchMe()).roles.botRole?.id ?? null;
  } catch (err) {
    log(`could not look up the bot's managed role, so only <@bot> mentions count: ${err.message}`);
  }
  log(`gateway ready as ${client.user.tag}${botRoleId ? ` (role ${botRoleId})` : ''}`);

  const channel = async (id) => client.channels.cache.get(id) ?? client.channels.fetch(id);

  function waitForCard(messageId, matches, timeoutMs) {
    if (matches(cards.get(messageId))) return Promise.resolve(cards.get(messageId));
    return new Promise((resolve) => {
      const waiter = (id, card) => {
        if (id !== messageId || !matches(card)) return;
        done(card);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      function done(card) {
        clearTimeout(timer);
        waiters.delete(waiter);
        resolve(card);
      }
      waiters.add(waiter);
    });
  }

  return {
    botUserId: client.user.id,
    botRoleId,

    async react(mention, emoji) {
      await (await channel(mention.channelId)).messages.react(mention.messageId, emoji);
    },

    async reply(mention, text) {
      const sent = await (await channel(mention.channelId)).send({
        content: text,
        reply: { messageReference: mention.messageId, failIfNotExists: false },
        allowedMentions: { parse: [] },
        // Discord drops a second send with the same nonce, so a replayed run
        // does not reply twice.
        nonce: mention.messageId,
        enforceNonce: true,
      });
      if (cardOf(sent.embeds) && !cards.has(sent.id)) cards.set(sent.id, cardOf(sent.embeds));
      const reply = {
        id: sent.id,
        text,
        async edit(next) {
          reply.text = next;
          await sent.edit({ content: next, allowedMentions: { parse: [] } });
        },
        waitForCard: (matches, timeoutMs) => waitForCard(sent.id, matches, timeoutMs),
      };
      return reply;
    },

    async fetchMention(channelId, messageId) {
      return toMention(await (await channel(channelId)).messages.fetch(messageId), client.user.id, botRoleId);
    },

    close: () => client.destroy(),
  };
}
