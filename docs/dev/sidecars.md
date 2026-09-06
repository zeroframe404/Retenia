# Media sidecars

The audio/video pipeline (sub-phase 6.4) drives two third-party binaries. Neither is bundled
in the installer: both are fetched on first use, verified against a SHA-256 checked into
`packages/ingest/src/sidecars/manifest.json`, and installed under `<userData>/bin`.
`docs/spec/07-architecture.md` §13.4 item 4 records why, and §7 describes the three-tier
resolver (`resources/bin` → `.sidecars/` → `<userData>/bin`).

## What is pinned

| Tool | Version | Licence | Source |
|---|---|---|---|
| ffmpeg (LGPL build) | `autobuild-2026-09-06-13-06` | LGPL-3.0-or-later | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) |
| whisper.cpp `whisper-cli` | `v1.9.2` | MIT | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |

Speech and voice-activity weights are pinned separately, in
`packages/ingest/src/media/weights.ts`: `ggml-small-q5_1` (the default),
`ggml-large-v3-turbo-q5_0` (preferred when a CUDA build is installed), `ggml-tiny` (the
integration test's), and `ggml-silero-v6.2.0` for VAD. All MIT, all from Hugging Face, all
pinned by the LFS oid — which for those repositories *is* the file's SHA-256.

The ffmpeg pin is a **dated** `autobuild-…` tag on purpose. BtbN also publishes a `latest`
tag, but its assets are rebuilt daily under the same file names, so a hash pinned against it
would be wrong within a day. A dated tag's asset names carry the upstream commit
(`ffmpeg-N-126435-gf93cd72dde-win64-lgpl.zip`) and never change.

## Licence notice (LGPL)

ffmpeg is used **as a separate process**, spawned with an argument array and never linked into
the application. That is the arrangement the LGPL exists for, and it is why ffmpeg's licence
does not reach Retenia's own code. Two obligations still stand and are met here:

- **Notice.** The build in use is the LGPL configuration published by BtbN/FFmpeg-Builds; it is
  unmodified. This file and the app's third-party notices name it.
- **Source.** The build recipe is at <https://github.com/BtbN/FFmpeg-Builds>, and FFmpeg's own
  sources for the pinned commit are at <https://github.com/FFmpeg/FFmpeg>. The binary is
  downloaded from BtbN's release rather than redistributed by us, so a user obtains it from the
  same place these sources describe.

Deliberately **not** using `ffmpeg-static`: it is a GPL-3 build, which would make the product
non-distributable (`docs/spec/07-architecture.md` §11 tracks that as a risk).

`tooling/scripts/check-licenses.mjs` cannot see any of this — it reads `pnpm licenses list`,
and these are not npm packages. There is therefore nothing to add to
`license-exceptions.json`, and this document is the record instead.

## Working on the pipeline

```bash
pnpm sidecars:install     # ffmpeg + whisper-cli + the GGML weights into .sidecars/
pnpm sidecars:install -- --cuda   # …and the 670 MB CUDA whisper build
pnpm sidecars:manifest    # re-pin sizes and hashes after bumping a version
```

`.sidecars/` is gitignored and sits ahead of `<userData>/bin` in the resolver, so a checkout
with it populated never downloads anything — which is also what lets
`src/media/media-pipeline.integration.test.ts` run. Without it that suite skips itself, with a
test that says so rather than passing silently.

## macOS

Nothing is pinned for macOS yet, and `resolveSidecar` answers `undefined` there. BtbN publishes
no macOS ffmpeg, and whisper.cpp ships an xcframework rather than a CLI, so there is no
prebuilt artifact to verify. Local transcription is therefore unavailable on macOS until
sub-phase 14.5 brings that platform up.
