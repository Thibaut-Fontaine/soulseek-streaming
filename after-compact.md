# SoulStream — after-compact handoff

Last updated: **2026-10-23**. Read this first after a context compaction, together
with the global agent rules (`~/agents-rules/AGENTS-GLOBAL.md`) and the VPS host
rules (`ssh vps-ovh 'cat ~/AGENTS.md'`).

---

## 1. What this project is

**SoulStream** is a React Native (iOS/Android) Soulseek streaming client in
`/home/thibaut/soulseek-streaming`.

- It logs in to the official Soulseek server, searches the P2P network, queues a
  file, receives it from a peer, and streams it through a local HTTP range proxy
  into `react-native-track-player`.
- **MP3 only** by design. The search filters out every other format and the
  transfer layer refuses non-MP3.
- **One-tap UX**: the user types a title, the app cleans the query locally,
  ranks incoming results with Levenshtein, stops the search as soon as a good
  match arrives, and starts playback in the background. The UI stays on the
  simple “Écoute” screen with a mini player; there is no results list or
  download button.
- The app currently **does not upload/share files**. This is a known compliance
  and etiquette gap (see §9).

---

## 2. Where everything lives

| Item | Value |
| --- | --- |
| Local project | `/home/thibaut/soulseek-streaming` |
| GitHub (private) | https://github.com/Thibaut-Fontaine/soulseek-streaming |
| GitHub collaborator | `CallaoVinicius`, permission `write` |
| Public download page | https://thibautfontaine.space/streaming/ |
| Public APK | https://thibautfontaine.space/streaming/SoulStream.apk |
| Public source ZIP | https://thibautfontaine.space/streaming/SoulStream-source.zip |
| VPS files | `/var/www/thibautfontaine.space/streaming/` |
| VPS service | existing `nginx`, **no nginx config change was needed** |
| Latest APK SHA-256 | `c8e05a03c40e26cc220f13b9e0ab48bfd2d520d8aba889cb77e4f1fc73fe2ed5` |
| APK size | `58 744 486` bytes |
| Source ZIP SHA-256 | `abb691ee6e86bcae2898122d40cb4ac489a5f94d8e376028e3df28766dd823c6` |
| Last code commit | `4209457 fix: keep the UI responsive while tracks load` |
| APK signing | Android **debug keystore**, release build (`app-release.apk`) |

The APK currently on the VPS was built from the working tree at the commit above.
The public source ZIP also predates the addition of this file, so it does not
contain `after-compact.md`; this is intentional/minor.

---

## 3. Current app behaviour (verified on Android 15 emulator)

- Auto-login with credentials stored in Android Keystore/Keychain.
- Search screen “Écoute”:
  - one input, one **Écouter / Arrêter** button;
  - while searching: “Recherche du meilleur MP3…” + the formatted query;
  - on match: playback starts automatically, the screen shows a compact
    “En lecture · Ouvrir” row and the global mini player;
  - no match after the 10 s search: “Aucun MP3 trouvé” + Relancer.
- Search stops when `pickBestMatch` returns `score >= 0.82`.
- Search maximum duration: **10 s**; watchdog: 15 s.
- The Soulseek `FileSearch` itself cannot be recalled (no protocol cancel), but
  the client closes the search session and **drops late responses before
  inflating them**.
- Playback preparation is asynchronous; switching tabs works while a track
  loads. The mini player shows `×` while preparing, which cancels preparation.
- Player tab still has full controls (pause, ±10 s, stop, retry, stream status).
- The search screen does **not** auto-switch to the player tab.

---

## 4. Recent fixes — do not regress

1. **Overlapping searches / blank UI** (commit `fef33bd` and earlier):
   - timer is bound to its own search object;
   - old search cannot finish the new one;
   - “Arrêter” cancels immediately;
   - `ErrorBoundary` prevents a completely blank screen on render errors.
2. **MP3-only** (commit `fef33bd`):
   - `src/core/types.ts` `STREAMABLE_EXTENSIONS = new Set(['mp3'])`;
   - search parser and `createTransfer` both enforce it.
3. **One-tap Levenshtein auto-play** (commit `b9e843c`):
   - `src/core/search.ts`: local query formatting, bounded Levenshtein,
     token-order-insensitive matching, token coverage, quality nudges;
   - threshold `AUTO_MATCH_SCORE = 0.82`;
   - store stops the search and calls `playHit` without awaiting.
4. **UI freeze while loading** (commit `4209457`):
   - late `FileSearchResponse`s are dropped **before pako inflation** when
     `activeSearch` is null;
   - search response guard: **512 KiB compressed**, **4 MiB inflated**,
     **500 files/response**, **200 hits**;
   - `RangeHttpServer` yields to the event loop every 2 × 64 KiB while feeding
     the native player;
   - mini player `×` cancels preparation.

Regression tests: `__tests__/search.test.ts`, `__tests__/client.test.ts` (fake
network, direct + indirect transfers), `protocol.test.ts`, `httpServer.test.ts`,
`bytes.test.ts`.

---

## 5. Architecture / key files

```
src/core/
  bytes.ts            little-endian binary helpers, UTF-8, ByteQueue
  framer.ts           TCP framing (server/peer vs peer-init)
  protocol.ts         codes + encoders/parsers + zlib search responses
  soulseekClient.ts   server + P/F connections + transfers + searches
  chunkBuffer.ts      append-only buffer with progressive waitFor
  transfer.ts         one download/stream state machine
  search.ts           query formatter + Levenshtein + best-match picker
  types.ts            SearchHit, MP3-only policy, display helpers
src/transport/
  rnTcpTransport.ts   react-native-tcp-socket adapter
  nodeTransport.ts    node:net adapter (tests / potential gateway)
src/stream/httpServer.ts   local HTTP Range proxy -> TrackPlayer
src/services/
  streaming.ts        orchestration, owns client + HTTP server
  settings.ts         AsyncStorage settings + Keychain credentials
src/state/store.ts    zustand store (search auto-play, player, transfers)
src/ui/               Login / Search / Player / Settings / MiniPlayer / TabBar
src/player/           TrackPlayer setup + background playback service
tools/fake-network.ts dev-only fake Soulseek server + peer
tools/demo.mp3        generated 28 s / 217 KB test MP3
patches/react-native-track-player+4.1.2.patch   Kotlin 2.1 nullability fix
```

Important native config:

- `android/gradle.properties`: `newArchEnabled=false` (TrackPlayer 4.1.2 is not
  TurboModule-compliant).
- `ios/Podfile`: `:new_arch_enabled => false`.
- `android/app/src/main/res/xml/network_security_config.xml`: cleartext only for
  `127.0.0.1`/`localhost`, for the local audio proxy.
- `AndroidManifest.xml`: `POST_NOTIFICATIONS`, network security config.
- `Info.plist`: `UIBackgroundModes = audio`, local networking description.
- `index.js`: registers the TrackPlayer playback service.

---

## 6. Build, test, run

```bash
cd /home/thibaut/soulseek-streaming

npm install                 # applies patches/ via patch-package
npm test                    # 42 tests, expected to pass (one Jest open-handle warning)
npm run typecheck
npm run lint                # warnings only (bitwise/inline styles), 0 errors

# Android release APK (the one deployed)
cd android
./gradlew assembleRelease --no-daemon
# -> android/app/build/outputs/apk/release/app-release.apk

# Install on the emulator/device
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

- iOS was never built here (Linux host). The Xcode project/Podfile are present,
  with the new architecture disabled.
- Do not commit `node_modules`, `android/build`, `android/app/build`,
  `android/app/.cxx`, `ios/Pods`, `android/local.properties`, `.git`.
- The release APK is signed with the template debug key; not Play-Store ready.

---

## 7. Emulator + fake network (for UI testing without a real account)

AVD: `SoulStream_API35` (Android 15, 720×1280, API 35, x86_64), package
`com.soulstream.app`.

```bash
# Headless emulator
~/Android/Sdk/emulator/emulator -avd SoulStream_API35 \
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot

# Wait for boot
adb wait-for-device
adb shell getprop sys.boot_completed   # expect 1

# Forward the app's Soulseek listening port to the host
adb forward tcp:22345 tcp:22345

# Fake server + peer (start from the repo root)
npx tsx tools/fake-network.ts
# env options:
#   FILE=/path/file.mp3     use another MP3
#   LATE_RESPONSES=40       send late 500-file search bursts (freeze regression)
#   SERVER_PORT=22420 PEER_PORT=22421 PEER_IP=10.0.2.2 CLIENT_PORT=22345
```

In the app login screen, set the server to **`10.0.2.2:22420`**. The fake server
accepts any credentials (the emulator currently has `test` / `test` saved and
auto-logs in). A search on `Fake` auto-plays the generated MP3. A search on
`none` produces no result and verifies the empty state.

Note: the fake server's `LATE_RESPONSES` burst is exactly what used to freeze the
UI; the current client drops it before inflating.

---

## 8. Deploy/update the public APK

```bash
cd /home/thibaut/soulseek-streaming

# 1. Build the release APK
cd android && ./gradlew assembleRelease --no-daemon && cd ..

# 2. Stage files (APK, page, screenshots, source)
#    The staging directory is /tmp/opencode/streaming-site in this session.
#    Source ZIP must exclude node_modules / build outputs / .git / Pods.
sha256sum android/app/build/outputs/apk/release/app-release.apk
# update the SHA-256 displayed in the landing page index.html

# 3. Upload to a fresh temp dir on the VPS (do NOT scp into /var/www directly)
ssh vps-ovh 'mkdir -p /home/ubuntu/soulstream-uploadN'
scp SoulStream.apk SoulStream-source.zip index.html SHA256SUMS.txt \
  vps-ovh:/home/ubuntu/soulstream-uploadN/

# 4. Install with correct ownership
ssh vps-ovh 'sudo install -d -m 755 -o www-data -g www-data \
  /var/www/thibautfontaine.space/streaming && \
  sudo install -m 644 -o www-data -g www-data \
  /home/ubuntu/soulstream-uploadN/* \
  /var/www/thibautfontaine.space/streaming/'

# 5. Verify publicly
curl -sSL https://thibautfontaine.space/streaming/SoulStream.apk | sha256sum
curl -sSL https://thibautfontaine.space/streaming/SoulStream-source.zip | sha256sum
curl -sSI https://thibautfontaine.space/streaming/SoulStream.apk

# 6. Housekeeping
ssh vps-ovh 'rm -rf /home/ubuntu/soulstream-uploadN'
ssh vps-ovh 'printf "%s - %s - %s\n" "$(date -u +%FT%TZ)" "opencode" \
  "updated SoulStream APK ..." >> ~/AGENT_CHANGELOG.md'
```

- If `/tmp/opencode/streaming-site` disappeared after a host restart, fetch the
  live page (`curl -sS https://thibautfontaine.space/streaming/ -o index.html`),
  recreate the assets from `docs/`, and update the SHA-256 in the page.
- **No nginx config/reload is needed**; `/var/www/thibautfontaine.space` is
  already the static root and `/streaming/` is served by `location /`.
- Do not touch `piano-midi`, `muay-thai`, `climate`, `easter-egg`,
  `eisenhower`, `instabot`, `llmcheck`, `nginx`, or other sites.
- `llmcheck.service` and `jobkit-fetch.service` were already failed before this
  deploy; do not "fix" them as part of a SoulStream update.

---

## 9. Sharing on Soulseek — research result

- Sharing is **not an account flag**. It is a **client feature**: the client
  declares shared folders and reports share counts to the server, and serves
  `SharedFileListResponse` / file uploads.
- Soulseek users strongly expect sharing; many clients have leech detection and
  can deny/ban non-sharers.
- Official alternative-client rules expect the full feature set, including
  upload. SoulStream currently has **no upload**, so it is not fully compliant.
- The README and Settings screen now explain this. Implementing sharing
  (folder picker + shared file index + upload transfers) is the priority next
  feature.
- Sources: https://www.slsknet.org/rules.html ,
  https://www.slsknet.org/news/faq-page ,
  https://www.slsknet.org/news/node/523 .

---

## 10. Network/request optimizations already in place

- One `FileSearch` per submitted query; identical query already running is
  ignored.
- Search stops at the first good match (10 s maximum, 15 s watchdog).
- `GetPeerAddress` cached for 10 min; refreshed once only if the connection
  fails; concurrent lookups deduplicated.
- `PlaceInQueueRequest`: one at 3 s, then at most one per minute, max 10.
- No `WatchUser`, `GetUserStats`, chat or distributed-tree participation.
- Late search responses are dropped before zlib inflation.
- Search response limits: 512 KiB compressed, 4 MiB inflated, 500 files,
  200 hits.
- HTTP range proxy yields to the UI thread every 2 chunks (128 KiB).

---

## 11. Known limitations / caveats

- No upload/sharing (see §9); some peers may refuse/ban.
- No obfuscated peer connections.
- No distributed search tree.
- NAT/CGNAT: the listening port must be reachable for the best results; indirect
  `ConnectToPeer` / `PierceFirewall` is implemented.
- One stream at a time.
- Seeking only within buffered bytes; no arbitrary-offset restart.
- In-memory buffer capped at 256 MiB (MP3s are small in practice).
- Android release APK uses the debug signing key.
- If the OS backgrounds the app **before playback starts**, iOS/Android may
  suspend JS/sockets; once playback is active, the native media service keeps
  it alive. Tab changes inside the app are no longer blocked.
- Soulseek login is plaintext at the protocol level (historical); credentials
  are stored locally in Keychain/Keystore.
- `FileSearch` cannot be recalled from the network; the app only stops its own
  session and ignores late results.

---

## 12. User preferences (important for future changes)

- UI should stay **simple, Spotify/SoundCloud-like**: a single listening layer,
  no result list, no download buttons, one clear action, mini player.
- Search should auto-play the first good match; stop the search as soon as a
  match is found.
- Downloads/search must happen asynchronously; **never block the UI**; tab
  changes must work during loading.
- Use **Levenshtein** and a local pre-search formatting layer before the
  Soulseek query. **No external DeepSeek/LLM API** was added; do not add one
  without an explicit API key/service decision.
- Only MP3.
- Minimize requests to Soulseek.
- The owner writes French; user-facing UI/docs are French, code comments English.
- GitHub repository is private; collaborator `CallaoVinicius` already added.
- VPS is updated with each user-visible build; owner downloads via
  `thibautfontaine.space/streaming`.

---

## 13. Resume checklist after compaction

1. Read this file, `README.md`, and `git log --oneline -5`.
2. `npm test && npm run typecheck` before changing anything.
3. Check `git status` is clean.
4. For UI work: start emulator + fake server (§7), use `adb forward 22345`.
5. For a public build: follow §8, update SHA on the page, verify public hashes,
   append `~/AGENT_CHANGELOG.md`, remove VPS temp dirs.
6. Do not touch nginx/other sites, do not expose secrets, do not add paid or
   third-party services without approval.
7. If the task is about sharing, start with the upload/shared-folder feature
   rather than tweaking the client’s display.
