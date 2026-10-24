# Unified catalog — research notes

Date: 2026-10-24. Status: research only, nothing implemented yet.

## Problem

Today every Soulseek file is its own search result. The title and artist are
guessed from the file path (`parseTrackName`), and the cover only exists when
that peer embedded one in the MP3's ID3 tag. So the same song shows up as many
rows with different spellings ("01 - one more time.mp3", "Daft Punk - One More
Time (Radio Edit)"), and often with no cover at all.

## The idea: entities first, files second (like IMDb)

IMDb has one page per film, and many places to watch it. We want the same:

- **Track** (canonical): title, artist, album, cover, duration, ISRC, from a
  public music catalog.
- **Sources**: the Soulseek files that are that track. A track card says
  "Daft Punk — One More Time · Discovery · 14 sources".
- **Artist** and **Album** pages built from the catalog. Their tracks are
  resolved on Soulseek only when the user taps one.

The cover, title spelling and album then come from the catalog, never from the
peer. The ID3 cover becomes a fallback.

## Catalog options (tested from the dev container on 2026-10-24)

| Source | Key needed | Covers | Typo-tolerant search | Limits / terms | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Deezer API** | No | Yes, up to 1000×1000 on a CDN | Yes ("daft pnk one mor time" → correct track first) | ~50 requests / 5 s (55 parallel calls all returned 200). Terms: non-commercial only; access can be cut at any time | **Primary choice** |
| **MusicBrainz** + **Cover Art Archive** | No (needs a descriptive User-Agent) | Yes, via release / release-group MBID | Weak; strict Lucene syntax | 1 request/s per IP, else HTTP 503 / IP block. Data is CC0 | **Fallback**, and the long-term open option |
| iTunes Search API | No | Yes (100×100 URL, rewritable to 600×600) | Good | ~20 requests/min per IP (third-party figure). Blocked (403) from this container, so untested | Optional secondary |
| Last.fm | Free API key | Yes | Has `autocorrect=1` | Key would ship in the app | Not needed |
| Spotify | OAuth client secret | Yes | Good | Secret can't ship safely in a mobile app; API access tightened since 2024 | No |
| Discogs | Token for images | Yes | Medium | 60 requests/min authenticated | No |

Deezer findings worth keeping:

- Plain `q=` search works; the advanced `artist:"…" track:"…"` syntax returned
  0 results in my test, so use plain text.
- Each track has `title_short` (no version) and `title_version` ("(Short Radio
  Edit)") — exactly the split we need to match "One More Time" vs. its edit.
- `duration` (seconds), `rank` (popularity), `album.cover_small/medium/xl`,
  and `isrc` on `/track/{id}`.
- `/search/artist`, `/artist/{id}/top`, `/artist/{id}/albums`,
  `/album/{id}/tracks` give us artist and album pages for free.

MusicBrainz finding: a recording search for "One More Time" returns
compilations first ("Boom 2001", "This Is Ultimate Dance"). If we use it, we
must prefer release groups of type Album/Single, status Official, earliest
date, or the cover will be a random compilation.

## How matching Soulseek files to a catalog track would work

Run both searches in parallel when the user types a query:

1. **Catalog search** (Deezer, ~200 ms): keep the top 5–10 tracks.
2. **Soulseek search** (existing flow).
3. **Match each incoming file** to a catalog track with a score built from what
   `search.ts` already has:
   - artist + title similarity (`normalizeForMatch`, token matching), using
     `title_short`;
   - **duration** within ±3 s of the catalog duration when the peer sent one
     (`hit.durationSec`). This is the strongest signal: it separates the album
     version (320 s) from the radio edit (235 s) and from live versions;
   - version words (`VERSION_WORDS`) must agree with `title_version`;
   - folder name vs. album title as a small bonus.
4. Files that match no catalog track are grouped among themselves by
   `normalized artist | normalized title | duration rounded to 5 s`, and shown
   as today (path-based title, ID3 cover) under "Other results".

Within a track, the existing `rankHits` / `availabilityScore` still picks the
best source and the fallback order. Auto-play should target the top catalog
track that has at least one good source.

**Bonus: better Soulseek queries.** Deezer fixes typos and accents. After the
catalog answers, the app can send the corrected "Artist Title" to Soulseek
(as a second search if the first one finds little). Soulseek peers only return
files that contain every query word, so a typo today means zero results.

## Albums from one peer

The protocol code already answers folder-contents requests for our own
uploads. Sending `FolderContentsRequest` to a peer would let an album page play
a whole album from one user's folder (consistent bitrate, tags and cover), with
per-track fallback to other peers.

## Caching

- Cache catalog answers by normalized query, and catalog track by id (small
  JSON on the device, LRU). Keep cover URLs, not images; the image cache of
  React Native handles the rest.
- Store the catalog id in `SavedTrack` so liked/history entries unify too, and
  old entries get a cover after the next lookup.
- Remember "this file = this catalog track" by `hitKey`, so repeated searches
  don't re-match.

## Things to decide

1. **Privacy / design choice.** `search.ts` says "no external API". Adding a
   catalog sends search text to Deezer (or MusicBrainz). Suggest an on-by-default
   setting "Use online catalog for covers and titles" with the current
   offline behaviour when it's off or the catalog is unreachable.
2. **Terms.** Deezer's API terms are non-commercial only and allow cutting
   access at any time. Fine for a free app; keep a provider interface so
   MusicBrainz can replace it.
3. **Direct or via the VPS.** Calling Deezer from the phone is simplest. A tiny
   proxy on thibautfontaine.space would add a shared cache and let us switch
   providers without an app update, at the cost of running a service.

## Suggested implementation steps

1. `src/core/catalog.ts`: `CatalogProvider` interface + Deezer provider
   (search tracks, artist, album) + MusicBrainz/CAA fallback; pure functions,
   tested with recorded JSON in `__tests__`.
2. `src/core/unify.ts`: match hits to catalog tracks (title, duration, version)
   and group the rest; unit tests with real-looking Soulseek paths.
3. Store: run catalog search alongside Soulseek search; keep `groups` next to
   `hits`; auto-play picks the best group.
4. UI: track cards with catalog cover + "N sources"; sources sheet per track;
   cover fallback catalog → ID3 → placeholder.
5. Artist and album pages; album playback from one peer's folder.
6. Settings toggle and library migration (catalog id on saved tracks).

## Prior art

- Lidarr / Soularr / slskd: the library is driven by MusicBrainz (release
  group ids), and Soulseek is only the download source — the same split as
  here.
- SoulSync: a strict matcher that rejects cross-version matches (bare title vs.
  "(acoustic)", "(live)"), which matches our `VERSION_WORDS` penalty.
- beets: tags downloads from MusicBrainz after the fact; AcoustID audio
  fingerprints (Chromaprint) can identify a file with no usable name, but need
  a native library and part of the audio, so it's a later option.

## Sources

- MusicBrainz API rate limiting: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
- MusicBrainz API: https://musicbrainz.org/doc/MusicBrainz_API
- Deezer API terms: https://developers.deezer.com/termsofuse
- iTunes artwork sizes: https://bendodson.com/weblog/2013/02/19/itunes-artwork-finder
- iTunes rate limit (third-party): https://publicapi.dev/i-tunes-api
- Lidarr FAQ (release group ids): https://wiki.servarr.com/Lidarr_FAQ
- SoulSync 3.4.5 notes: https://newreleases.io/project/github/Nezreka/SoulSync/release/3.4.5
