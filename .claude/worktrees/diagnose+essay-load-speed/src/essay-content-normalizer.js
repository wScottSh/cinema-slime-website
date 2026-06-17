import MarkdownIt from 'markdown-it';

const SAFE_URL_RE = /^(https?:|mailto:)/i;

function extractYoutubeId(url) {
  const watchMatch = url.match(
    /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{11})(?:&[^#]*)?(?:#.*)?$/
  );
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/^https?:\/\/youtu\.be\/([\w-]{11})(?:[?#].*)?$/);
  if (shortMatch) return shortMatch[1];
  return null;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Returns the URL of a paragraph whose only content is a single auto-linked
// URL (link text === href), or null if the token at `i` is not such a
// paragraph. These bare links are the only candidates for a YouTube embed.
function soleAutoLinkUrl(tokens, i) {
  if (
    tokens[i].type !== 'inline' ||
    tokens[i - 1]?.type !== 'paragraph_open' ||
    tokens[i + 1]?.type !== 'paragraph_close'
  ) {
    return null;
  }
  const children = tokens[i].children;
  if (
    !children ||
    children.length !== 3 ||
    children[0].type !== 'link_open' ||
    children[1].type !== 'text' ||
    children[2].type !== 'link_close'
  ) {
    return null;
  }
  const href = children[0].attrGet('href');
  return href === children[1].content ? href : null;
}

// Core plugin: replace a paragraph that is nothing but a YouTube link with a
// .youtube-embed iframe.
function youtubePlugin(md) {
  md.core.ruler.push('youtube_embed', (state) => {
    const { tokens } = state;
    // Iterate backwards so splicing replaced tokens leaves earlier indices intact.
    for (let i = tokens.length - 1; i >= 1; i--) {
      const url = soleAutoLinkUrl(tokens, i);
      if (!url) continue;
      const youtubeId = extractYoutubeId(url);
      if (!youtubeId) continue;
      const htmlToken = new state.Token('html_block', '', 0);
      htmlToken.content = `<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${escapeAttr(youtubeId)}" allowfullscreen loading="lazy" title="YouTube video"></iframe></div>\n`;
      tokens.splice(i - 1, 3, htmlToken);
    }
  });
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
}).use(youtubePlugin);

md.validateLink = (url) => SAFE_URL_RE.test(url.trim());

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const defaultImage =
  md.renderer.rules.image ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('loading', 'lazy');
  return defaultImage(tokens, idx, options, env, self);
};

export function normalizeEssayContent(markdown) {
  const raw = typeof markdown === 'string' ? markdown : '';
  if (!raw.trim()) return { bodyHtml: '', rawMarkdown: raw };
  return { bodyHtml: md.render(raw), rawMarkdown: raw };
}
