// Pure filter: given an episode list, a type filter, and a search query,
// returns the matching subset. No DOM, no globals — data in, slice out.
export function filterEpisodes(list, type, query) {
  return list.filter(ep => {
    const matchType = type === 'all' || ep.episodeType === type;
    const matchSearch = !query ||
      ep.title.toLowerCase().includes(query.toLowerCase()) ||
      ep.description.toLowerCase().includes(query.toLowerCase());
    return matchType && matchSearch;
  });
}
