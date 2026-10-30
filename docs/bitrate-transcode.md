# Smallest bitrate and 94 kbps transcode — decision note

Status: **selection policy implemented and tested; native encoder blocked**
(feature 10, October 2026).

## Why

SoulStream streams MP3s from peers. On mobile data and low-RAM phones a small
file starts faster and fills the cache with less. The owner asked for a
"smallest source, 94 kbps when needed" policy. 94 kbps is the product target:
it is close to 96 kbps CBR, the lowest standard MPEG-1 Layer III rate that
still sounds acceptable for most music; LAME can target it with ABR
(`--abr 94`).

The app already has every source's size, duration and announced bitrate in
`SearchHit`, so the *decision* can be made without a network call.

## Implemented now (pure, tested)

`src/core/transcode.ts`, tests in `__tests__/transcode.test.ts`:

- `sourceBitrateKbps`: announced bitrate, else `size × 8 / duration`.
- `choosePlaybackSource`:
  1. sort by bitrate (smallest first), then size, then rank;
  2. a source at or below 128 kbps whose uploader can sustain its own bitrate
     is played **as is** (`small-source`);
  3. if no source is small, pick the smallest and mark it **transcode** to
     94 kbps (`no-small-source`);
  4. if the smallest source's uploader is too slow (reported speed below its
     bitrate with 20 % headroom), prefer a faster source and mark it
     **transcode** (`slow-uploader`); if none is faster, keep the small one;
  5. an unknown bitrate is played **as is** rather than guessed down;
  6. `encoderFailureFallback` returns the same source with `action:
     'original'` — playback never waits for a failed encoder.
- Policy is configurable (`targetKbps`, `smallSourceKbps`,
  `speedSafetyFactor`).

Not wired to the player yet on purpose: the native encoder does not exist, so
`choosePlaybackSource` is dead code until it does. Wiring it without an
encoder would either change source selection for no benefit or silently lie
about transcoding.

## Native encoder options

| Option | License | APK size / ABIs | Decode MP3? | Maintenance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **LAME + NDK** (encoder) | LGPL-2.0 | ≈ 0.3–0.6 MB per ABI stripped (arm64-v8a, armeabi-v7a); needs CMake/NDK and vendored C source | No: LAME only encodes PCM. Pair with Android `MediaCodec` MP3 decoder (or minimp3/CC0) | Stable, low activity | **Best technical fit**, but needs owner approval to vendor source + NDK build |
| **ffmpeg-kit** | LGPL/GPL variants | Tens of MB per ABI for useful builds; a full ffmpeg is far larger than LAME | Yes | **Retired in 2025**; prebuilt binaries are no longer published | Rejected: dead dependency, huge, licence complexity |
| **Java LAME port** (e.g. jump3r-style) | LGPL | ≈ 1 MB dex, no ABI split | No | Unmaintained; JIT on low-end CPUs is slow, likely below real time for 44.1 kHz stereo | Rejected: CPU and maintenance risk |
| **Android MediaCodec alone** | platform | 0 | Decodes MP3 only; Android exposes no MP3 **encoder** (AAC only) | Platform | Rejected: AAC would break the MP3-only policy |
| **Server-side transcode** | — | 0 | — | Needs a VPS service and upload of copyrighted audio | Rejected: no new service, privacy and cost |

### Why this is blocked

A real MP3→94 kbps MP3 transcode needs **both a decoder and an encoder**.
LAME is only the encoder; the Android platform can decode MP3 (`MediaCodec`)
but cannot encode it. The feasible stack is therefore LAME C source built with
the NDK, fed PCM by `MediaCodec`, behind a JNI wrapper. That means:

1. vendoring third-party C source (LGPL) and adding a CMake target;
2. shipping and testing two ABIs (plus x86_64 for emulators);
3. a real-device benchmark proving the phone can encode faster than real time;
4. deciding whether transcoding happens while streaming or only on a finished
   cache file.

None of that is allowed in this lot without an explicit owner decision on a
large vendored dependency. **No native encoder was added and no transcode test
is faked.**

Also note the bandwidth truth: transcoding after download does **not** reduce
mobile-data usage. Only choosing a smaller source does. Transcoding reduces
cache/upload size and the bitrate sent to the native player; if the goal is
data usage, the policy's smallest-source rule is the part that matters.

## Exact next step for the owner

Approve (or reject) this stack:

- vendor LAME 3.100 under `android/app/src/main/cpp/lame/` (LGPL-2.0,
  `NOTICE` updated, licence text and relinking information shipped);
- add CMake/`externalNativeBuild` for `arm64-v8a` and `armeabi-v7a`, optional
  `x86_64` for the emulator;
- JNI `Mp3Transcoder` with a testable contract:
  `start({ sampleRate, channels, bitrate: 94 }) → write(PCM) → finish()`,
  exposing `unavailable` when the library is missing (pure selection already
  falls back to original);
- decode with `MediaCodec` (MP3 decoder) into PCM, encode with LAME, then feed
  the local HTTP proxy; benchmark on the Redmi before enabling by default;
- a setting (off by default) and instrumentation/fixture tests with a known
  MP3, checking duration, sample rate and bitrate of the output.

Until then, only the pure policy and its tests are in the repository.
