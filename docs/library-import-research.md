# Library import from streaming apps — research

Date: 2026-10-25. Status: research done, nothing implemented. First item of
`TODO.md`.

Goal: let a user bring their library (liked tracks, playlists, albums,
artists) from another music app into SoulStream, choosing what to import.

## Summary

**Account linking is closed or impractical for almost every service in 2026.
Import from files instead.** Every major service lets users download their
own data, and free tools export any service to CSV. SoulStream reads the file
on the phone, lets the user tick what to import, and matches each track to the
Deezer catalog we already use (by ISRC when the file has one). No account
login, no server, no API key, nothing sent anywhere except the catalog
lookups the app already does.

## Account linking (APIs): why not

| Service | Library API | Status for SoulStream |
| --- | --- | --- |
| Spotify | Web API, OAuth PKCE | Development mode is limited to **5 users** per app and requires the developer to have Premium (Feb 2026). Extended quota is for organisations only, with **250k+ monthly users** (since May 2025). Unusable for a public app. |
| Deezer | OAuth user API | **New app registration has been closed** for months, with no reopening date. The public, keyless API we use cannot read a user's library. |
| Apple Music | MusicKit (has an Android SDK) + Apple Music API | Needs the Apple Developer Program and a signed developer token: the signing key cannot safely ship in the app, so it needs a server. Subscribers only. |
| YouTube Music | None official | Only unofficial, reverse-engineered APIs (fragile, against terms). |
| TIDAL | Open API v2, OAuth PKCE, collection scopes | The only open option. Small user base; could be a later, optional extra. |

## File exports: what users can get today

| Source | How the user gets it | Content | Notes |
| --- | --- | --- | --- |
| Spotify "Download your data" | Account → Privacy → request; zip by email, up to ~5 days | JSON: `YourLibrary.json` (saved tracks, albums, artists, as of the request), playlist files (name, tracks with track/artist/album names) | Official and free. Field names and whether track URIs are included must be checked on a real export (sources disagree). No ISRC, no duration. |
| Exportify (Spotify) | Web app, one CSV per playlist | Track name, artists, album, duration, release date, Spotify IDs (columns vary by fork) | Free, open source; depends on Spotify's API quota. |
| YouTube Music | Google Takeout → YouTube and YouTube Music | `music-library-songs.csv` (video ID, song title, album, artist); playlist CSVs contain **only video IDs** + dates | Liked/library songs import well; playlists need titles we do not have. |
| Apple Music (Mac/PC app) | File → Library → Export Playlist → Plain Text (tab-separated, UTF-16 "Unicode" option) or M3U | Every tag field: name, artist, album, time... | Desktop only. privacy.apple.com exports are less documented. |
| Apple Music → YouTube Music | Apple's own transfer service | Then export via Takeout | Detour, but official. |
| Deezer | No documented user export; TuneMyMusic "Deezer to file" | CSV/TXT: playlists, favourite tracks, albums, artists | TuneMyMusic and Soundiiz are freemium; they work for every service. |
| Any player | M3U / M3U8 | `#EXTINF:duration,Artist - Title` lines | Common, simple, includes duration. |

Formats marked "must be checked" need real sample files before writing the
parsers: the cheapest way is the owner's own exports (see "Decisions").

## Matching to the catalog

- **ISRC available** (some CSV exports): `GET https://api.deezer.com/track/isrc:{ISRC}`
  — verified to work on the public API without a key (returns the track,
  album and cover). Same for albums: `album/upc:{UPC}`.
- **Otherwise**: Deezer search with "artist title", then score candidates with
  the existing matcher logic (title/artist similarity, version words such as
  "live"/"remix", duration ±3 s when the file has one). Deezer's
  `artist:"…" track:"…"` advanced syntax returned no results in tests; plain
  queries work.
- Keep unmatched rows: show them as "not found" with the original text, and
  allow a plain Soulseek search from it.
- **Never search Soulseek during import.** Sources are found on play
  (`resolveTrack`), as today. Importing 2,000 songs must not send 2,000
  Soulseek searches.
- Rate: the catalog provider throttles at ~8 requests/s and caches. 2,000
  tracks ≈ 4–5 minutes in the background, with progress, resumable, and
  cancellable. ISRC hits and repeated tracks across playlists are deduplicated
  first.

## Proposed design

1. **Settings → Bibliothèque → Importer** (and an entry in the empty library
   state): pick one or more files with the document picker already in the app
   (`@react-native-documents/picker`). Accept `.zip` (Spotify data), `.json`,
   `.csv`, `.txt` (tab-separated), `.m3u`/`.m3u8`.
2. **Detect the format** from file names and headers; CSV columns are
   detected by name in several languages (track/title/titre/name, artist,
   album, duration/time, ISRC). One parser per known source, plus a generic
   CSV/M3U fallback.
3. **Selective import screen**: collections found in the files (each playlist,
   "Titres likés", albums, artists) with counts and checkboxes; a preview of
   the first tracks; then "Importer".
4. **Background matching** with a progress bar; the user can leave the screen.
   Result: "1 840 trouvés, 160 non trouvés", with the list of the latter.
5. **Library**: imported liked tracks join "Titres likés"; playlists become
   SoulStream playlists; albums and artists are saved for quick access.
   Tracks play like any catalog track (sources found on tap).

### Code impact

- New `src/core/importers/` (pure, unit-tested with sample files): `spotify.ts`,
  `csv.ts` (generic, column detection), `m3u.ts`, `appleText.ts`,
  `takeout.ts`; a common `ImportedTrack { title, artist, album?, durationSec?,
  isrc?, sourceId? }` and `ImportedCollection { kind, name, tracks }`.
- `CatalogProvider`: add `trackByIsrc(isrc)` and a batch matcher.
- **Library model change**: `SavedTrack` requires a Soulseek `hit` today.
  Imported tracks have none until played, so saved entries must allow a
  catalog track without a hit, and the library needs **playlists** (new).
  Storage moves from one AsyncStorage JSON blob to something that scales to
  thousands of entries (chunked keys or SQLite) — check on low-RAM devices
  (`TODO.md` item 3).
- Zip reading for the Spotify export: a small pure-JS unzip (e.g. `fflate`,
  ~8 kB) or `pako` (already a dependency) with a minimal zip reader.

## Decisions for the owner

1. Go with **file import only** for now (no account linking)? TIDAL account
   linking could come later as an option.
2. **Sample files**: the owner's own Spotify "Download your data" zip and, if
   possible, a Google Takeout YouTube Music export and a TuneMyMusic CSV, to
   build and test the parsers on real data (personal data: keep them out of
   the repo; only anonymised fixtures get committed).
3. **Playlists** become a new library feature (needed to import them).

## Sources

- Spotify developer-mode changes: https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/ ,
  https://vorplabs.com/agent-tools/spotify-api-changes
- Deezer app registration closed: https://pypi.org/project/deezer-oauth-cli/ ,
  https://en.deezercommunity.com/other-devices-49/create-developer-app-82800
- Spotify data download: https://support.spotify.com/ca-en/account_payment_help/privacy/understanding-my-data/ ,
  https://tuneferry.com/blog/export-spotify-playlists-every-method-2026
- Exportify: https://github.com/pavelkomarov/exportify/wiki
- YouTube Music Takeout: https://support.google.com/accounts/answer/14792019?hl=en ,
  https://www.playlistgo.io/export/youtube-music-to-csv/ ,
  https://github.com/TeamNewPipe/NewPipe/issues/5370
- Apple Music: https://developer.apple.com/musickit , https://support.apple.com/120030 ,
  https://support.apple.com/en-au/guide/itunes/itns2998/mac
- TIDAL API (via a client library): https://minim.readthedocs.io/en/latest/api/minim.tidal.API.html
- TuneMyMusic Deezer to file: https://www.tunemymusic.com/transfer/deezer-to-file
