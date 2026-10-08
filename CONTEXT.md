# Cinema Slime Website — Domain Language (CONTEXT)

This document is a glossary of domain concepts only.
It contains **no** implementation details, technology choices, file names, or architectural decisions.

---

## Episode
A single audio installment of the Cinema Slime Podcast, as published in the RSS feed.
Every Episode has a title, publication date, full description, audio enclosure, artwork, duration, season and episode number (when applicable), and type (full episode, bonus, or trailer).
The brand identifies an Episode by its season together with its episode number; the size of the whole catalogue is a separate fact about the collection, not part of an Episode's identity.

## Episode Page
A distinct, addressable view dedicated to one specific Episode.
Its primary purpose is to present the Episode's complete, untruncated description (and associated metadata) in a readable form, separate from the constrained space of list or card views.

## Chapter
A named, timestamped part of an Episode, as listed in the Episode's description (for example "(18:09) LOGAN x 2017").
A Chapter runs from its timestamp to the next Chapter's, and the last runs to the end of the Episode. Playback can start at any Chapter.

## Episode Identifier
A stable, unique value that refers to exactly one Episode across time, reloads, and different views.
It is used to address an Episode Page directly (for example via a link or bookmark).

## Discovery View
The primary browsing experience of the site in which users encounter the collection of Episodes.
It presents Episodes in card and hero formats with search and filtering capabilities, optimized for scanning and finding episodes of interest.

## Playback
The user intent and action of starting to listen to a specific Episode's audio content.
Playback is distinct from viewing an Episode Page; the two can occur independently or together.

## Essay
A single written long-form piece associated with Cinema Slime, distinct from audio Episodes.
Every Essay has a title, publication date, full body content, author(s) when applicable, and type (when applicable).

## Cover Image
The single image that stands for an Essay wherever the Essay is presented as one of many rather than read.
Every Essay has one. A Cover Image is derived from the Essay, not authored as part of it — an Essay is never published with a Cover Image of its own.

## Film Leader
A generated image evoking a length of blank film stock: sprocketed edges over a Cinema Slime brand-palette field, bearing the Cinema Slime name.
It serves as the Cover Image of an Essay that carries no image. It is a thematic texture, not the Cinema Slime brand mark.

## Essay Page
A distinct, addressable view dedicated to one specific Essay.
Its primary purpose is to present the Essay's complete, untruncated body (and associated metadata) in a readable form, separate from the constrained space of list or card views.

## Essay Identifier
A stable, unique value that refers to exactly one Essay across time, reloads, and different views.
It is used to address an Essay Page directly (for example via a link or bookmark).

## Curation
The brand's authoritative selection of which Essays are Official.
It is the single source of truth for Essay membership: an Essay becomes Official by being added to the Curation and ceases to be Official when removed, independent of any edits the author makes to the Essay itself.

## Official Essay
An Essay the brand has endorsed by including it in the Curation.
Only Official Essays are presented on the site as Essays; an author's other writing, and the brand's ordinary messages, are never shown as Essays even when they exist.

## Cinema Slime Name
The author display name shown for an Official Essay, as designated by the brand through the Curation.
It is controlled by the brand and may differ from any name the author uses elsewhere; when the brand designates no name, no author name is shown.

## Essay Slug
A short, human-readable address for an Official Essay, designated by the brand through the Curation.
It is a brand-controlled alternative to the Essay Identifier for addressing an Essay Page: distinct from the Identifier, which is the immutable value tied to the Essay itself, the Slug is chosen by the brand, must be unique among Official Essays, and may be absent (an Essay can be Official without one). When present it is the preferred way to refer to the Essay; the Essay Identifier always remains a valid alternative.
Slugs follow one standard rule: an episode or numbered issue is named by its work and number (`spider-man-noir-s1e5`, `absolute-batman-1`), anything else by its own name.

## Slug Alias
An Essay Slug an Official Essay used to have, kept in the Curation so links already shared with it keep working.
Visiting a Slug Alias lands on the Essay Page at its current Slug, and its Link Preview names the current address. A Slug Alias belongs to exactly one Official Essay, and no Slug Alias is ever another Essay's Slug or Alias: Slugs and Slug Aliases share one namespace. Renaming an Essay's Slug turns the old one into a Slug Alias.

## Curator
The brand's agent that changes the Curation on request: it makes an Essay Official, gives it an Essay Slug (proposing one from the title when none is asked for), and credits a new author with the Cinema Slime Name it is told.
It acts only when a brand member asks it to, always edits the newest Curation (never a remembered copy of an older one), refuses rather than guesses (an unnamed new author, a Slug another Essay holds, a Curation it cannot read), and answers each request once, with the Essay's link.

## Craig Recording
The recording of one podcast session, made in Discord by the Craig recording bot, from which a new Episode is produced.
A brand member hands a Craig Recording to the Curator with its link, and the Curator passes it to the podcast editor, which starts the Episode. Handing the same recording over twice starts it once; the second time answers with the Episode already started.

## Curation Run
One request to the Curator carried through to its answer: the Essay's content secured, the Curation changed if it needed to be, the Essay Page's Link Preview in place and checked.
A Curation Run either ends with the Essay's link or says which step stopped it. Asking again for an Essay that is already Official changes nothing and answers with its link.

## Syndication
A third party reproducing Cinema Slime content (Episodes and Official Essays) on their own surface by reading the brand's public, ever-changing content sources directly, rather than copying from the brand's own site.
The brand treats its content sources as public: anyone may discover the current set of Episodes and Official Essays and present them elsewhere. Syndication is regarded as pure additional reach — engagement and provenance accrue to the brand through the content sources themselves regardless of where the content is presented — so it carries no attribution or permission obligation on the syndicator.

## Guaranteed Presence
The brand's guarantee that an Official Essay's body is actually readable wherever the site looks for it, not merely that the Essay's coordinate has been added to the Curation.
Being on the Curation and being guaranteed present are independent facts: an Essay can be Official (on the Curation) while its body is unreachable, which is exactly the failure this guarantee closes. The brand achieves it by holding its own copy of the Essay's original signed content and keeping that copy available wherever it looks, independent of whether the author's own publishing location remains reachable.


## Link Preview
The card a chat app or social network shows when someone posts a link to the site: a title, a short description and an image.
Every Episode Page and Essay Page has its own Link Preview, describing that Episode or Essay; every other address shows the site-wide one. A page that has just appeared may show the site-wide Link Preview for a short while before its own exists.
