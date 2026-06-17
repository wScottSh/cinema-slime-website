// Pure filter: given an episode list, a type filter, and a search query,
// returns the matching subset. No DOM, no globals — data in, slice out.
export function filterEpisodes(list, type, query) {
  const needle = query.toLowerCase();
  return list.filter(ep => {
    const matchType = type === 'all' || ep.episodeType === type;
    const matchSearch = !query ||
      ep.title.toLowerCase().includes(needle) ||
      ep.description.toLowerCase().includes(needle);
    return matchType && matchSearch;
  });
}
