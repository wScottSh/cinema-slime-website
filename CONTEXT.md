# Cinema Slime Website — Domain Language (CONTEXT)

This document is a glossary of domain concepts only.
It contains **no** implementation details, technology choices, file names, or architectural decisions.

---

## Episode
A single audio installment of the Cinema Slime Podcast, as published in the RSS feed.
Every Episode has a title, publication date, full description, audio enclosure, artwork, duration, episode number (when applicable), and type (full episode, bonus, or trailer).

## Episode Page
A distinct, addressable view dedicated to one specific Episode.
Its primary purpose is to present the Episode's complete, untruncated description (and associated metadata) in a readable form, separate from the constrained space of list or card views.

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

