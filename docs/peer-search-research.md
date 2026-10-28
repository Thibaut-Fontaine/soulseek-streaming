# Soulseek (peer) search queries — research

Date: 2026-10-25. Research done on `main` at `bda876b` (1.3-beta8); the
proposed strategy is implemented since (see "Implemented" at the end). The
sections below describe the code *before* that change.

## What the app sends today

**Playing a catalog title** (`resolveTrack` → `findSources` in
`src/state/store.ts`, query built by `soulseekQueryFor` in `src/core/unify.ts`):

1. `artist + title`, where the title is Deezer's `title_short` with anything
   in brackets removed, plus the *kind* of version when it is a remix, live,
   acoustic or instrumental. Then `formatSearchQuery` (`src/core/search.ts`)
   drops noise words (`remaster(ed)`, `official video`, bitrates, `mp3`…),
   `feat./ft.`, apostrophes (`don't` → `don t`) and one-letter words.
2. Sent **in lowercase**, plus an **accent-free copy** when the query has
   accents (since 1.3-beta6; this fixed `SYSTÈME D`, see below). Both run in
   parallel, 6 s.
3. If no file matched: **title only**, with the time left (9 s budget in
   total), and only if the title has 6+ letters. Files are then accepted
   mostly on duration (±3 s).

So the artist **is** in the first query; the title-only query is the retry,
and it is the one visible last in the journal when the first one found
nothing.

**Typed search** with the catalog on: no Soulseek request (since 1.3-beta8).
"Chercher les fichiers sur Soulseek" sends the typed text (cleaned the same
way) and the catalog's spelling of the top result.

### Case and accents — fixed

Deezer writes some titles in capitals (`SYSTÈME D`). The query used to go
out as typed; some clients do not fold case for accented letters, and many
files carry no accents. Since 1.3-beta6 (merged in `main`): lowercase, plus
an accent-free copy.

## How peers match a query

Soulseek's own algorithm is not published. The reference is Nicotine+
(`pynicotine/search.py`, `_process_search_request`), which matches the
official client's behaviour on the points it documents:

- The query is lowercased and **punctuation is removed**; it is split on
  spaces.
- Each word must be found as a **whole word** in an index built from the
  file's **full path** (folders + file name). All words are required (AND).
  No stemming, no substring match: `don` does not match `dont`, `2011`
  must be in the path.
- `-word` excludes files containing that word; `*ending` matches words that
  end with `ending` (suffix only). At least one plain word is required.
- A minimum query length applies (whole string), and each peer caps its
  number of results.
- The server sends **excluded phrases** (`ExcludedSearchPhrases`, code 160):
  some phrases are banned network-wide and searches containing them return
  nothing, with no way to tell from a real "no result".

Consequences: every extra word is a chance to miss files; words must be
spelled as they are in paths; the artist can be in a folder name (it counts).

## Problems found (real Deezer titles)

Run of `soulseekQueryFor` + `soulseekSpellings` on Deezer answers:

| Deezer title | First query sent | Problem |
| --- | --- | --- |
| Stairway to Heaven (Remaster) — Led Zeppelin | `led zeppelin stairway to heaven` | fine |
| Let It Be (Remastered 2009) — The Beatles | `the beatles let it be` | fine |
| "Heroes" (2017 Remaster) — David Bowie | `david bowie heroes` | fine |
| Don't Stop Me Now **- Remastered 2011** (version after a dash, not in brackets) | `queen don stop me now 2011` | **`2011` is required** (and `remastered` would be, if it were not a noise word): almost no file has it → nothing found. Dash versions (`- Remastered 2011`, `- 2009 Remaster`, `- Live`, `- Radio Edit`, `- Single Version`, `- Mono`) are not recognised as versions. |
| Don't Stop Me Now | `… don stop …` | **Apostrophes**: `don` must be a whole word; files named `Dont Stop Me Now` don't match. Same for `I'm`/`Im`, `rock 'n' roll`. |
| Stairway to Heaven (Live 1972; Remaster) | `led zeppelin stairway to heaven` | **Matching bug**: the whole version counts as "neutral" because it contains `remaster`, so the `live` is ignored when scoring files (`meaningfulVersion` tests the whole string). Only the duration check saves it here. |
| A — Coldplay | `coldplay` | **Very short title**: the title disappears (one letter), the query is the artist only → hundreds of unrelated files; the title-only retry is skipped. |
| Système D — Jungle Jack | `jungle jack système` + `jungle jack systeme` | fine since 1.3-beta6 (`D` dropped on purpose: one letter) |
| Get Lucky (feat. Pharrell Williams) — Daft Punk | `daft punk get lucky` | fine |

Other cases to expect:

- **Artist spellings**: `The Beatles` vs folders named `Beatles`; `Jay-Z`
  (`jay-z` is sent as one word, peers strip the dash: likely `jayz` or
  `jay z` — to verify); `AC/DC`, `Guns N' Roses`, `P!nk`.
- **Numbers**: `Part 2` vs `Pt. II`, `Vol. 2` vs `Volume 2`.
- **`&` / `and`**: `&` is dropped, `and` is kept as a required word.
- **No artist in the path** (`Music/One More Time.mp3`): covered by the
  title-only retry.
- **Banned phrases**: nothing to do but fall back to other queries.

## Proposed strategy

A ladder of queries per title, stopping as soon as good sources arrive
(the existing early stop: 3 free sources, or 1.5 s after the first one),
inside the existing 9 s budget:

1. **Clean title** (new, pure function with a table of tests built from
   real Deezer titles):
   - remove versions after ` - ` as well as in brackets, when they are
     neutral (`remaster(ed) YEAR`, `YEAR remaster`, `mono`, `stereo`,
     `single/album version`, `deluxe`…); keep the kind of version for real
     variants (`live`, `remix`, `acoustic`, `instrumental`) — judged per part
     (`;`, `/`, `,`), not on the whole string;
   - remove years and quotes; drop words containing an apostrophe (the other
     words are enough) instead of sending a broken half;
   - keep at most ~4 distinctive title words (longest first) so long titles
     do not fail on one variant word.
2. **Query A** — `artist + clean title` (+ accent-free copy).
3. **Exclusions for a studio version**: append `-live -karaoke -instrumental
   -remix` (only words not in the catalog title). Peers send fewer junk
   files: less data to parse on slow phones, better first results.
4. **Query B** (if A found nothing) — title only, when the title is
   distinctive (2+ words or 6+ letters); duration decides.
5. **Query C** (if still nothing) — `artist + album`, matching files by title
   and duration. Ties in with TODO "One Soulseek search per album".
6. **Very short titles** (`A`, `Go`): never send the artist alone; use
   `artist + album` directly.
7. Log each step with its result count in the journal (partly done), to tune
   the ladder from real sessions.

Fix independently: `meaningfulVersion` judging each part of the version
(the `Live 1972; Remaster` bug).

## Implemented

In `src/core/unify.ts` (tests: `__tests__/peerQuery.test.ts`, ladder end to
end in `__tests__/catalogStore.test.ts` with fake peers that match like real
ones, `matchQuery` in `test-utils/multiPeerNetwork.ts`):

- `splitTitle` / `trackTitleParts`: versions in brackets **and** after
  ` - ` are split from the name, part by part (`;`, `,`, `/`). Brackets that
  are part of the name (`(Don't Fear) The Reaper`) are kept; guests and
  "from the film" brackets are dropped.
- `meaningfulVersion` judges each part: a part made only of neutral words and
  years is neutral; `Live 1972; Remaster` → `Live`. Matching uses the clean
  name plus that version.
- `formatSearchQuery` (`search.ts`) drops words with an apostrophe, except
  French elisions (`l'amour` → `amour`); `'69` → `69`.
- `soulseekLadder`: artist (without a leading "The") + at most 4 title words
  (stop words dropped first) + kind of version → title only (2+ words or 6+
  letters) → artist + album (not for self-titled albums). A one-letter title
  goes straight to the album. Every step carries `-live -karaoke
  -instrumental -remix`, minus any word found in the artist, title, version
  or album. `soulseekQueryFor` stays the plain query (no exclusions) for the
  local cache and the file list.
- `findSources` (`store.ts`) runs the steps in order inside the 9 s budget
  (first step up to 6 s, 2 s kept per later step), stops at the first step
  with a source, and logs each step with its file and source counts in the
  journal.

Still open: artist spellings (`Jay-Z`, `AC/DC`, `P!nk`), numbers (`Part 2` /
`Pt. II`), `&` vs `and`; check in real sessions (journal) whether the
exclusions ever cost a good file, and tune from the per-step counts.

## Sources

- Nicotine+ search handling: https://github.com/nicotine-plus/nicotine-plus/blob/master/pynicotine/search.py
- Soulseek protocol (FileSearch, ExcludedSearchPhrases): https://nicotine-plus.org/doc/SLSKPROTOCOL.html
- Search syntax, folders included in matching: https://en.wikipedia.org/wiki/Soulseek
- Banned search phrases in practice: https://github.com/fiso64/sockseek/issues/128
- Other tools' strategies (artist-maybe-wrong, remove feat., album search): https://github.com/aasimsyed/slsk-batchdl , https://glama.ai/mcp/servers/voidtype/slsk_mcp
