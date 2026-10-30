# `GET /api/app/version` — update manifest contract

This folder is the server-side contract of the in-app updater. **It is not
deployed by the app release.** The owner decides when and where to mount it on
the VPS.

## Request

```
GET /api/app/version
Accept: application/json
```

No authentication, no query parameters. The response is public because the
APK it points to is already public.

## Response (200)

```json
{
  "versionCode": 19,
  "versionName": "1.4.0",
  "apkUrl": "https://thibautfontaine.space/streaming/SoulStream.apk",
  "sha256": "<64 lower-case hex characters>",
  "sizeBytes": 59521454,
  "notes": "Short French release notes.",
  "publishedAt": "2026-10-30T10:00:00Z"
}
```

- `versionCode` is compared with the installed Android `versionCode`
  (`android/app/build.gradle`). The app only prompts when it is **strictly
  greater**.
- `apkUrl` must be **HTTPS**. The client refuses any other scheme.
- `sha256` is the SHA-256 of the APK. The client hashes the downloaded file
  with `react-native-blob-util` and deletes it when the digest differs.
- `notes`, `sizeBytes` and `publishedAt` are optional. A negative or zero
  `sizeBytes` makes the manifest invalid.

`app-version.json` is a valid fixture for local tests; replace the digest and
the version when publishing.

## Errors

| Status | Meaning |
| --- | --- |
| 404 | Any other path |
| 405 | Any method other than `GET` (`Allow: GET`) |
| 500 | The manifest file is missing or invalid |

The app treats any error, timeout or offline answer as "no update": checking
must never block startup or break the running build.

## Mounting it (owner action, not done here)

Serve the validated JSON from the existing site, for example with a tiny
serverless handler or a static file mapped to the route. Do not change nginx
configuration as part of an app-only release.
