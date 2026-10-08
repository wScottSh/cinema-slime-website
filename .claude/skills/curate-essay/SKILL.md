---
name: curate-essay
description: Explains how to add, rename, or republish a Cinema Slime Official Essay now that the Curator bot owns the Curation. Use when the user pastes a Nostr long-form post, naddr, or essay link and wants it curated, listed, renamed, or published as an Official Essay.
---

# Curate an Essay

The agent does not curate Essays. The Curator bot does, from Discord. The live kind:30001 Curation is the only list; there is no `ESSAYS` array to edit and no publish wizard (ADR 0021).

Tell the user to post in #admin-convos:

```
@Cinema Slime Curator <naddr or njump / habla / yakihonne / primal link>
@Cinema Slime Curator <link> slug:the-slug              (choose the address of a NEW Essay)
@Cinema Slime Curator <link> name:"Display Name"        (first Essay by a new author)
@Cinema Slime Curator <link> rename slug:new-slug       (change a listed Essay's address)
```

The bot reacts with 👀, captures the Essay, publishes the Curation, writes the Essay Page, verifies its Link Preview, and replies once with the link.

Break-glass when Discord is down (the operator, on the droplet; the CLI refuses while the daemon holds the lock):

```
systemctl stop cinemaslime-bot
cinemaslime-bot curate '<link>' [--slug s] [--name "N"]
systemctl start cinemaslime-bot
```

Read-only checks the agent may run: `npm run check:curation` and `npm run check:coverage`. See `docs/curation-workflow.md`.
