# SoulStream log ingest (feature 7)

Small, dependency-free HTTPS log sink for the app's **opt-in, anonymous**
debug journal. Nothing is deployed by the repository: this is the code and
the operator steps.

## Privacy contract

The app sends, when **Réglages → Confidentialité → Envoyer les journaux
(anonyme)** is on (default off):

- a random installation id (`inst_` + 32 chars), no account, no password,
  no Soulseek username;
- the app version and `android` / `ios`;
- redacted log lines: `password=`, `token`, `Authorization`, `username=`,
  `source N : <peer>`, absolute and Soulseek paths, e-mails and IP addresses
  become `[redacted]`, `<path>`, `[email]`, `[ip]`.

Redaction runs **on the device** (`src/core/logPrivacy.ts`) and **again on the
server** before storage. The server never stores the client IP (it is only
used for the rate limiter) and never prints request bodies.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/logs` | `X-Installation-Id` (+ optional bearer token) | append a report |
| `DELETE` | `/v1/installations/:id` | same installation id | delete everything for it |
| `GET` | `/v1/health` | none | liveness |

`POST` body (max 64 KiB by default, 1–100 events, 2 000 chars per message):

```json
{
  "schema": 1,
  "installationId": "inst_0123456789abcdef",
  "app": { "version": "1.3.0", "platform": "android" },
  "events": [
    { "at": 1700000000000, "level": "info", "tag": "play", "message": "…" }
  ]
}
```

Responses: `202 {"accepted":N}`, `400` malformed, `401` missing/bad id,
`403` body id ≠ header id, `413` too large, `415` not JSON, `429`
`rate_limited` with `Retry-After`.

Rate limits (defaults): 120 requests/min per installation, 300/min per IP.
Retention/rotation (defaults): 7 days and 50 000 events; older events and the
oldest entries are dropped. `FileLogStore` rewrites a mode-600 JSON snapshot
atomically after each batch.

## Run on the VPS (owner step, not done here)

```bash
# Compile only the server (no new dependency; the repo already has tsc).
npx tsc -p server/logs/tsconfig.json
node server/logs/dist/server/logs/index.js

# Example systemd unit (new unit name, do not reuse llmcheck/instabot/nginx).
# Environment=PORT=8099 SOULSTREAM_LOG_FILE=/var/lib/soulstream-logs/events.json
# ExecStart=/usr/bin/node /home/ubuntu/soulstream-log-ingest/index.js
# User=ubuntu, NoNewPrivileges=yes, ProtectSystem=strict,
# ReadWritePaths=/var/lib/soulstream-logs
```

nginx must terminate TLS and proxy the public path to `127.0.0.1:8099`
(`proxy_set_header X-Forwarded-For $remote_addr;` and `TRUST_PROXY=1`). **Do
not edit nginx from an agent session**: the owner reviews and adds the
location after this code review. The app's default endpoint is
`https://thibautfontaine.space/logs/v1/logs` (`src/services/remoteLog.ts`).

## Tests

```bash
npx jest __tests__/logPrivacy.test.ts __tests__/logUpload.test.ts \
  server/logs --runInBand
```

Covers validation, bounded body, rate limits, id mismatch, redaction,
retention, rotation, deletion, persistence, offline queue and retry.
