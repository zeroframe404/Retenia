#!/usr/bin/env node

/**
 * Regenerates `sample-20s.webm`, the fixture `src/media/media-pipeline.integration.test.ts`
 * runs the whole audio/video pipeline over.
 *
 * It has to satisfy four things at once, which is why it is generated rather than found:
 *
 *  - **Real speech**, or whisper returns an empty transcript and the acceptance criterion
 *    ("a 20-s sample produces a transcript with timestamps") cannot be checked at all.
 *  - **Real scene changes**, so the keyframe pass has something to find.
 *  - **Text on screen**, so the OCR seam is exercised end to end rather than only with a fake.
 *  - **Small enough to commit** — 74 kB, in line with the `.pdf`/`.epub`/`.pptx` fixtures
 *    beside it, so the pure tests (dHash over real frames) run in CI where the binaries do not.
 *
 * VP9 + Opus in WebM, because the LGPL ffmpeg build the app ships has no H.264 encoder (x264
 * is GPL) and Chromium plays WebM natively — so the same file is both a decode fixture and
 * something the player can actually render in a story.
 *
 * Run with `node packages/ingest/test/fixtures/media/build.mjs` after
 * `pnpm sidecars:install`, which fetches both ffmpeg and `jfk.wav`. The tests read the
 * committed `.webm`, never this script.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '../../../../..')
const sidecars = path.join(projectRoot, '.sidecars')

const FFMPEG_VERSION = 'autobuild-2026-09-06-13-06'
const ffmpeg = path.join(
  sidecars,
  'ffmpeg',
  FFMPEG_VERSION,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
)
const speech = path.join(sidecars, 'models', 'jfk.wav')
const output = path.join(here, 'sample-20s.webm')

for (const [what, where] of [
  ['ffmpeg', ffmpeg],
  ['jfk.wav', speech],
]) {
  if (!existsSync(where)) {
    process.stderr.write(`missing ${what} at ${where}\nrun \`pnpm sidecars:install\` first\n`)
    process.exit(1)
  }
}

// Three flat-coloured sections with a caption each, changing at 0 / 7 / 14 s. The colours are
// what the scene filter and the dHash see; the captions are what OCR reads. `apad` stretches
// the 11-second speech clip to the full 20 seconds so the transcript does not end early.
const chain = [
  "[0:v]drawbox=x=0:y=0:w=320:h=240:color=0x8C3A1B@1:t=fill:enable='between(t,7,14)'",
  "drawbox=x=0:y=0:w=320:h=240:color=0x1B5C2E@1:t=fill:enable='gte(t,14)'",
  "drawtext=font=Sans:fontsize=26:fontcolor=white:x=(w-tw)/2:y=60:text='SECTION ONE':enable='lt(t,7)'",
  "drawtext=font=Sans:fontsize=26:fontcolor=white:x=(w-tw)/2:y=60:text='SECTION TWO':enable='between(t,7,14)'",
  "drawtext=font=Sans:fontsize=26:fontcolor=white:x=(w-tw)/2:y=60:text='SECTION THREE':enable='gte(t,14)'",
].join(',')

const result = spawnSync(
  ffmpeg,
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x1B3A5C:s=320x240:d=20:r=10',
    '-i',
    speech,
    '-filter_complex',
    `${chain}[v];[1:a]apad=whole_dur=20[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '120k',
    '-deadline',
    'good',
    '-cpu-used',
    '4',
    '-c:a',
    'libopus',
    '-b:a',
    '24k',
    '-t',
    '20',
    output,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

if (result.status !== 0) process.exit(result.status ?? 1)
process.stderr.write(`wrote ${path.relative(projectRoot, output)}\n`)
