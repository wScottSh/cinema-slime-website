import { defineConfig } from 'vite';

// The Curator bot as one self-contained ESM file for the droplet (ADR 0021):
// discord.js and nostr-tools are bundled in, so the droplet needs only Node,
// never npm or a checkout.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'bot/main.js',
    outDir: 'dist-bot',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: {
      // Optional native accelerators @discordjs/ws probes for and runs without.
      external: ['zlib-sync', 'bufferutil', 'utf-8-validate'],
      output: { entryFileNames: 'cinemaslime-bot.mjs', codeSplitting: false },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
