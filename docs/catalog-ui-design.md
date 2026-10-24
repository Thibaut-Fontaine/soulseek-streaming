# Catalog UI — design spec

Date: 2026-10-24. Goes with `docs/unified-catalog-research.md` (data side) and
`src/core/catalogTypes.ts` (contract). UI text is French; tokens come from
`src/ui/theme.ts` (dark, violet accent, Spotify-like type scale).

## Principles

- **Entities first, files second.** Titles, artists, albums and covers come
  from the catalog; Soulseek files are "sources" shown as a chip.
- **Same app without the catalog.** When `catalogResults` / `browse` are null
  (setting off, offline, provider down), every screen falls back to today's
  file-based look. Nothing blocks on the catalog.
- **One clear action per surface**: tap a row = play; ⋮ / long press = menu;
  tap an artist/album = open its page.

## Navigation: page stack

- `state.pages` is one global stack, drawn by `PageHost` (`src/ui/pages.tsx`)
  over the tab content and under the mini player + tab bar (which stay
  usable). Pages below the top stay mounted (`display: none`) so their scroll
  survives "back"; the tab underneath stays mounted too.
- **Tab change clears the stack** (tab bar, including re-tapping the current
  tab, and code calling `setTab`). Why not per-tab stacks: no navigation
  library, three tabs, and pages are cheap to reopen; one stack keeps Android
  back predictable and avoids stale hidden stacks.
- Android back order (`App.tsx`): sheet → player → top page → Réglages → exit.
- Header: round back button always visible; a surface bar with the page title
  fades in once the hero scrolls away.

## Screens

| Screen | Layout | Loading | Error | Empty |
| --- | --- | --- | --- | --- |
| **Artist** | Full-width picture hero (≈0.8×width, max 340) fading to bg, name in display type over it; "N fans"; row: Radio (ghost) · Shuffle · Play (accent); "Titres populaires" (5, "Afficher plus" → 10, numbered rows with cover); "Discographie" → shelves "Albums" (album+compilation) and "Singles et EP"; "Les fans aiment aussi" (round artist cards) | Gradient hero with the known name, track + shelf skeletons | StatusCard + "Réessayer" (`load(id, true)`) | Text line |
| **Album** | Tinted gradient, 220 px cover, title, artist (link), "2001 · Album · 14 titres · 1 h 01 min"; Shuffle · Play; numbered tracklist without covers, "Disque N" headers when >1 disc, version + artists as secondary text, E badge; release date + © label; "Plus de <artiste>" shelf | Cover skeleton + 8 row skeletons | Same as artist | "La liste des titres n’est pas disponible." |
| **Genre** | Gradient hero with picture and name; Shuffle · Play; "Artistes" round shelf; "Titres du moment" (10, expandable) | Shelf + rows skeletons | Same | Text line |
| **Search** (catalog on) | Field, status/scan bar, offline/error cards (unchanged); "Sur votre appareil"; **Meilleur résultat** (artist card if the query is the artist name, else top track with play button and source count); **Titres** = catalog `groups` (cover, title, artist · album, "N sources" chip → sources sheet; 5 then "Afficher plus"); **Artistes** shelf; **Albums** shelf; **Autres fichiers** = groups with `track === null`, path-based `TrackRow` | Catalog tracks shown with "Aucune source" until the matcher fills `groups` | Existing cards | Existing "Aucun MP3 trouvé" only when the catalog has nothing either |
| **Search** (catalog off) | Exactly today's layout | | | |
| **Accueil** | Existing quick grid / device / liked / recent searches on top, then "Top titres" (track cards), "Albums du moment", "Artistes populaires", "Genres" (2-column coloured tiles), credit line | 3 shelf skeletons + genre grid skeleton | Amber card "Nouveautés indisponibles" + Réessayer | Section hidden; welcome empty state only if browse isn't ready |
| **Player** | Large catalog cover (`Artwork.large`) and blurred backdrop; title → album page, artist → artist page; "Lecture depuis" uses `catalogContext.label` first | | | |
| **Mini player** | Catalog cover + title via `trackForHit` | | | |

## Components (`src/ui/catalog.tsx`, `components.tsx`)

- `Cover` — catalog artwork (size chosen from px × density: small ≤ 64,
  medium ≤ 300, else large) → ID3 `coverUri` → generated gradient; falls
  through on load error; `rounded="round"` for artists.
- `CatalogTrackRow` — number or cover, title, E badge, artist · album (or
  custom subtitle), "N sources" chip or duration, ⋮. Per-track status from
  `resolutions[id]`: spinner + "Recherche de sources…", greyed (45 %) + "Aucune
  source sur le réseau pour l’instant", red "Recherche impossible".
- `AlbumCard`, `ArtistCard` (round), `TrackCard`, `GenreTile`, `Shelf`,
  `PlayButtons`, `MoreToggle`, `Skeleton`, `TrackListSkeleton`, `ShelfSkeleton`.
- `useTrackInfo(hit)` now prefers the matched catalog track (`trackForHit`,
  then `SavedTrack.catalog` from liked/history), so every existing row, the
  player and the queue get catalog titles/covers for free.
- Sheet `catalogActions`: Écouter · Lire ensuite · Ajouter à la file · Aller à
  l’artiste · Aller à l’album · Voir les sources (or "Chercher des sources" →
  `resolveTrack`). The file actions sheet gains the same artist/album links
  when the file is matched.
- Settings → "Catalogue" group: "Catalogue en ligne" switch
  (`settings.catalogEnabled`).

## States summary

- **Loading**: pulsing skeletons in the final layout (no spinners on pages).
- **Error**: `StatusCard` with cause and "Réessayer".
- **Offline / catalog off**: catalog sections disappear; file-based UI remains.
- **No source** for a catalog track: row greyed with a message, still tappable
  (tapping retries the search).
