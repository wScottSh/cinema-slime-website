// Pure RSS-feed → Episode mapping. Takes an already-parsed XML Document so the
// DOMParser boundary stays in the caller (browser) and this module is testable
// in Node against any DOM implementation.

const ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';

function mapItem(item, fallbackImage) {
  const getText = (tag) => {
    const el = item.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  };
  const getItunes = (tag) => {
    const el = item.getElementsByTagNameNS(ITUNES_NS, tag)[0];
    return el ? (el.getAttribute('href') || el.textContent.trim()) : '';
  };
  const enc = item.getElementsByTagName('enclosure')[0];

  return {
    title: getText('title'),
    pubDate: getText('pubDate'),
    description: getText('description'),
    audioUrl: enc ? enc.getAttribute('url') : '',
    image: getItunes('image') || fallbackImage,
    duration: getItunes('duration'),
    episode: getItunes('episode'),
    season: getItunes('season'),
    episodeType: getItunes('episodeType') || 'full',
    link: getText('link'),
    guid: getText('guid'),
  };
}

export function parseEpisodes(xmlDoc, fallbackImage = '') {
  const items = xmlDoc.getElementsByTagName('item');
  return Array.from(items).map((item) => mapItem(item, fallbackImage));
}
