export function getEpisodeByIdentifier(identifier, episodes) {
  if (!identifier || typeof identifier !== 'string' || !Array.isArray(episodes)) {
    return null;
  }
  const id = identifier.trim();
  if (!id) return null;
  return episodes.find(ep => ep && typeof ep.guid === 'string' && ep.guid.trim() === id) ?? null;
}
