# VPS APIs and app update manifest

Last updated: 2026-10-30
Owner: Thibaut Fontaine. This file is for Claude and any agent deploying or
debugging the SoulStream server endpoints.

## Where the code lives

- `server/logs/` — dependency-free Node log ingest API (HTTP adapter, bounded
  body, rate limits, redaction, retention, atomic file storage).
- `server/version-api/` — `GET /api/app/version` contract, fixture and test.
- `src/core/logPrivacy.ts` — validation/redaction shared by app and server.
- `src/core/update.ts` — manifest validation and version comparison.
- App clients: `src/services/logUploader.ts`, `src/services/remoteLog.ts`,
  `src/services/updates.ts`, `src/state/updateStore.ts`, `src/ui/UpdatePrompt.tsx`.
  These app clients are currently on the `dev` branch; `main` stays on the
  public 1.3.0-beta15 app. The server code is on `main`.

## Public endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST https://thibautfontaine.space/logs/v1/logs` | opt-in redacted log batch |
| `GET https://thibautfontaine.space/logs/v1/health` | liveness |
| `DELETE https://thibautfontaine.space/logs/v1/installations/:id` | delete one anonymous installation |
| `GET https://thibautfontaine.space/api/app/version` | current APK manifest |

The app sends `X-Installation-Id` (random `inst_…`, not the Soulseek account).
The log setting is **off by default**; nothing is sent until the user enables
Réglages → Confidentialité → Envoyer les journaux.

## Log ingest service on the VPS

- Unit: `/etc/systemd/system/soulstream-log-ingest.service`
- User: `ubuntu`
- Working directory: `/home/ubuntu/soulstream-log-ingest`
- Listener: `127.0.0.1:8100` (do **not** use 8099; it belongs to
  `portfolio-unlock.service`)
- Storage: `/var/lib/soulstream-logs/events.json` (mode 600)
- Retention: 7 days / 50 000 events by default
- Rate limits: 120/min per installation, 300/min per client IP
- Optional bearer token: `SOULSTREAM_LOG_TOKEN`; leave unset for the current
  app because it does not send one.

Environment file `/home/ubuntu/soulstream-log-ingest/env` (mode 600):

```text
PORT=8100
SOULSTREAM_LOG_FILE=/var/lib/soulstream-logs/events.json
SOULSTREAM_LOG_DAYS=7
SOULSTREAM_LOG_RECORDS=50000
TRUST_PROXY=1
```

Build and deploy from the repository root:

```bash
npx tsc -p server/logs/tsconfig.json
# output: server/logs/dist/server/logs/index.js
```

Copy `server/logs/dist` to `/home/ubuntu/soulstream-log-ingest/dist`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now soulstream-log-ingest.service
sudo journalctl -u soulstream-log-ingest -n 30 --no-pager
curl -sS https://thibautfontaine.space/logs/v1/health
```

The unit must use a new name, never `llmcheck`, `instabot` or `nginx`. Keep
`ReadWritePaths=/var/lib/soulstream-logs`; do not run it as root.

## Nginx

TLS terminates in nginx; the app never calls port 8100 directly.

```nginx
location ^~ /logs/ {
    proxy_pass http://127.0.0.1:8100/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 15s;
    client_max_body_size 128k;
}

location = /api/app/version {
    default_type application/json;
    alias /var/www/thibautfontaine.space/streaming/dev/version.json;
    add_header Cache-Control "public, max-age=300";
    add_header X-Content-Type-Options nosniff;
}
```

`/streaming/` is excluded from the portfolio `rsync --delete`, so the manifest
under `/streaming/dev/` is safe. Do not put it at the site root.

## Version manifest and automatic update

`https://thibautfontaine.space/api/app/version` is a static JSON manifest
served from `/var/www/thibautfontaine.space/streaming/dev/version.json`:

```json
{
  "versionCode": 19,
  "versionName": "1.3.0-beta16",
  "apkUrl": "https://thibautfontaine.space/streaming/dev/SoulStream.apk",
  "sha256": "6fc75bb766480d95cf730010e77a4c6589cb5cb6f3a580e023950429cbf08b3b",
  "sizeBytes": 52368599,
  "notes": "Build dev 1.3.0-beta16 (lots 1-3).",
  "publishedAt": "2026-10-30T12:11:00Z"
}
```

The dev app checks it at startup (non-blocking), compares the installed
`versionCode` from `BuildConfig`, and only prompts for a strictly greater
code. The APK must be HTTPS on `thibautfontaine.space`, its SHA-256 must match,
and Android shows its own install confirmation. The app never installs
silently.

### Publishing a new version

1. Bump `versionCode` and `versionName` in `android/app/build.gradle` and the
   `version` in `package.json` (dev branch until the release is promoted).
2. Build: `cd android && ./gradlew assembleRelease --no-daemon`.
3. Compute `sha256sum` and the byte size of the APK.
4. Copy the APK over `https://thibautfontaine.space/streaming/dev/SoulStream.apk`
   (or the stable path when promoting).
5. Update `/var/www/thibautfontaine.space/streaming/dev/version.json` with the
   new code, name, URL, SHA, size, notes and date. Keep the JSON valid.
6. Verify:
   `curl -sS https://thibautfontaine.space/api/app/version | jq .`
   and `curl -sS -o /dev/null -w '%{http_code}\n' <apkUrl>`.
7. On next app launch, a strictly newer code shows the prompt.

Current dev build: **1.3.0-beta16 / versionCode 19**, SHA
`6fc75bb766480d95cf730010e77a4c6589cb5cb6f3a580e023950429cbf08b3b`.
The public beta15 app (versionCode 18) does not contain the update client yet;
only the dev APK does.

## Privacy and security rules

- Logs are opt-in, redacted on the device **and** again on the server.
- Never store the Soulseek account, password, tokens, peer names, file paths,
  e-mails or IP addresses. The rate limiter keeps IPs in memory only.
- Keep the log file mode 600 and the directory mode 700.
- Do not add an nginx location outside the reviewed blocks; back up the config
  and run `sudo nginx -t` before reload.
- Do not print or commit tokens. Do not point `rsync --delete` at `/var/www`.
- Cloud Claude sessions must not edit nginx or deploy to the VPS; the VPS owner
  deploys from his DeepSeek sessions.

## Current deployment state

- `main` contains the server code and this document.
- `dev` contains the app clients and the beta16 APK source; the beta16 APK is
  published under `/streaming/dev/`.
- Stable public site/APK: 1.3.0-beta15, unchanged.
