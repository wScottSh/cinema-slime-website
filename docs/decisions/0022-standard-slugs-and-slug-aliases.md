# Standard Essay Slugs, Slug Aliases, and the Curator command workflow

**Date**: 2026-10-07
**Status**: accepted
**Amends**: ADR 0005 (Essay Slugs in the Curation), ADR 0021 (the Curator)
**Context**: The 17 Official Essays had slugs picked one at a time: some by piece (`the-mirror`), some by series (`absolute-batman-3`), and one by a typo (`cat-eyes` for Absolute Batman #2). The operator wants one rule for every slug, applied by us, without breaking a single link already shared.

---

## Decisions

### 1. One slug rule

`pickSlug` in `src/essay-slug.js` derives every slug the same way:

1. Remove `(Spoilers)` and trim. Split the title on ` - `.
2. If a part carries an episode marker `SnEm` (anywhere in the part) or an issue marker `#n`, the slug is that part without the marker, cut at the first `:`, plus `-s<n>e<m>` or `-<n>`. The number is always kept, `#1` included.
3. Otherwise (a film, a standalone piece), the slug is the first part cut at the first `:`, with a standalone ` x ` separator dropped so a trailing year stays.
4. A slug already taken gets `-2`, `-3`, and so on.

`src/essay-slug.test.js` pins the rule against every historical title.

### 2. Slug Aliases live in the Curation

An old slug is kept as a tag on the live kind:30001, `["alias", <oldSlug>, <coordinate>]`. The Curation stays the single source of truth: the site, the deploy and refresh renderers, and the bot all read aliases from the same event.

- **Shape.** A tag of its own, rather than extra elements on the `a` tag, because an Essay can collect any number of aliases and an `a` tag has a fixed layout other clients read. The coordinate, not the current slug, is the target, so a later rename never leaves an alias pointing at a slug that moved.
- **Validation** (`curationFromEvent`, strict): an alias is a valid slug, names a listed coordinate, and is never a current slug or another alias. Slugs and aliases share one namespace, so `applyCurate` and `pickSlug` treat an alias as taken.
- **Rename** (`applyRename`): the previous slug becomes an alias of the same coordinate. Renaming back to one of its own aliases removes that alias. Another Essay's alias is refused as `slug-taken`.
- **Site** (`parseCurationList`, lenient): returns `aliasToCoordinate` and ignores an alias that is malformed, points at an unlisted coordinate, or shadows a current slug or an earlier alias. `/essay/<alias>` resolves to the coordinate and `history.replaceState`s to `/essay/<current slug>` (or the coordinate when the Essay has no slug), and the canonical route renders the page. The redirect is client-side because nginx serves the share pages as static files.
- **Link Previews.** `essayPageSpecs` writes a page for every alias too, carrying the Essay's canonical meta (`og:url` is the current slug's URL). Deploys, the hourly refresh (`scripts/render-share-pages.mjs`) and the bot all use that one renderer, so an old link unfurls with the right card and lands on the right page. The nginx share location already serves any `/essay/<segment>` directory, so nginx is unchanged.

### 3. Bulk standardize is a CLI-only Curator command

`applyStandardize(curation, titles)` is a pure edit: it re-derives every slug in list order, moves each changed slug to an alias, and returns `unchanged` when nothing differs. It never hands out a slug another Essay still owns, as a slug not yet re-derived or as an alias; the later Essay keeps it and the earlier one is suffixed. It refuses (`titles-missing`) rather than guess a slug for an Essay whose title it cannot read.

`cinemaslime-bot standardize` runs it in one capture-free Curator run: read the Curation, harvest every listed body (for the titles), apply the edit, pass the presence gate, publish once, render, then fetch every page (slug, coordinate and alias pages) as Discordbot and require the canonical `og:url` and `og:title`. `--dry-run` prints the old -> new table and publishes nothing. Rerunning converges: a standard list is `unchanged`.

It is not a Discord command. `parseMention` cannot produce it, because a mistaken mention would rewrite every address on the site at once.

### 4. The admin lever: `.github/workflows/curator-command.yml`

A `workflow_dispatch` with a choice input `command` (`standardize --dry-run`, `standardize`). It shares the `droplet-bot` concurrency group with `deploy-bot.yml` and the same SSH secrets and pinned host keys.

- The choice is mapped to fixed arguments in the job, so no input text reaches the droplet's shell.
- `deploy/bot/curator-command.sh run <args>` stops `cinemaslime-bot` (the CLI refuses while the daemon holds the Curator lock) and runs `/usr/local/bin/cinemaslime-bot <args>`, the break-glass shim that shares the daemon's user, lock, state and brand-key credential. Its output is the job log, and its exit status fails the job.
- `curator-command.sh start` runs in an `if: always()` step: it starts the bot and waits up to 60 s for `gateway ready` in the journal, so a failed or cancelled command never leaves the bot stopped.
- The shim passes arguments through `systemd-run` verbatim. Checked locally on systemd 259: an argument with spaces stays one argument, `--dry-run` reaches the bundle rather than `systemd-run`, and `--wait` returns the command's exit status.

## Rollout

The renderers must know about aliases before the Curation carries any, or a deploy or refresh running older code would prune the alias pages. So: merge, deploy `live` (deploy-live and deploy-bot both run), run `standardize --dry-run`, read the table, then run `standardize`.

## Alternatives considered

- **A fifth element on the `a` tag listing old slugs.** One tag per Essay, but variable-length `a` tags are unusual for NIP-51 readers, and adding an alias would rewrite the Essay's own entry. Lost to a separate tag.
- **Aliases in a file on the droplet or in git.** A second source of truth: the site, the refresh and the bot would each need it, and it could disagree with the live list. Lost on ADR 0021's single-list rule.
- **nginx 301s from old slugs.** Needs an nginx change per rename and a config generated from the Curation. The static alias page with the canonical `og:url`, plus a client-side `replaceState`, needs neither.
- **A Discord `standardize` command.** Lost on blast radius: one mistaken mention would move every address. The workflow gives a dry run and a job log instead.

## Consequences

- Every slug the Curator ever assigned keeps working, and keeps unfurling as its Essay.
- Aliases accumulate; nothing removes one except renaming back to it. A future remove verb must decide whether an Essay's aliases go with it (the strict codec refuses an alias to an unlisted coordinate, so they must).
- Accepted risk: cancelling the workflow mid-command can leave the CLI's transient unit running and holding the Curator lock when `start` brings the daemon up. The daemon exits on the held lock and systemd restarts it every 10 s (`Restart=always`) until the CLI finishes; if that takes longer than 60 s, `start` fails the job even though the bot comes back on its own.
