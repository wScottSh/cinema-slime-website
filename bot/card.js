// Discord-side verification of a curated reply's Link Preview. Our HTML is
// already verified before the reply is posted; this checks the card Discord
// actually built, which can still be generic if Discord unfurled the URL
// before the page existed and cached it.

const CARD_TIMEOUT_MS = 30_000;

export function cardMatches(card, meta) {
  if (!card?.url || !card.title) return false;
  return card.title === meta.title && card.url.split('?')[0] === meta.url;
}

// reply: { text, edit(text), waitForCard(matches, timeoutMs) -> card | null }.
// One ?v=<curation created_at> retry: nginx ignores the query, Discord treats
// it as a new URL and unfurls it fresh.
export async function verifyDiscordCard(reply, outcome, { timeoutMs = CARD_TIMEOUT_MS } = {}) {
  const matches = (card) => cardMatches(card, outcome.meta);
  if (await reply.waitForCard(matches, timeoutMs)) {
    await reply.edit(`${reply.text}\n✅ Discord preview card verified.`);
    return 'verified';
  }
  const bustedUrl = `${outcome.url}?v=${outcome.createdAt}`;
  const busted = reply.text.replace(outcome.url, bustedUrl);
  await reply.edit(busted);
  if (await reply.waitForCard(matches, timeoutMs)) {
    await reply.edit(`${busted}\n✅ Discord preview card verified (Discord had cached an old card for the plain link; share this one).`);
    return 'verified-after-bust';
  }
  await reply.edit(`${busted}\n⚠️ The page is live, but I didn't see Discord build its preview card within ${timeoutMs / 1000}s.`);
  return 'not-observed';
}
