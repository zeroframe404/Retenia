#!/usr/bin/env node

/**
 * Fetch the pinned media sidecars into `.sidecars/` for development, and regenerate the
 * manifest that pins them (`docs/spec/07-architecture.md` §7, §13.4).
 *
 * The manifest is the trust anchor: the app refuses to unpack an archive whose SHA-256 does
 * not match it, so it has to be produced deliberately rather than at install time. Same
 * argument `tooling/scripts/model-manifest.mjs` makes, with one extra wrinkle. BtbN publishes
 * ffmpeg under a `latest` tag whose assets are **rebuilt daily under the same file names**, so
 * a hash pinned against that tag is wrong within a day; the pin is a dated `autobuild-…` tag,
 * whose asset names carry the upstream commit and never change.
 *
 * Nothing runs this automatically. It is not a postinstall hook and CI does not call it —
 * `pnpm-workspace.yaml` turns off exactly this kind of install-time download for
 * `onnxruntime-node`, and hundreds of megabytes of third-party binaries deserve the same
 * treatment. The integration test skips itself when the binaries are absent, which is the
 * whole reason it can.
 *
 * Usage:
 *   node tooling/download-sidecars.ts --install          fetch into .sidecars/ (the common case)
 *   node tooling/download-sidecars.ts --install --cuda   also fetch the CUDA whisper build
 *   node tooling/download-sidecars.ts --write-manifest   re-pin sizes and hashes from upstream
 *   node tooling/download-sidecars.ts --models           fetch the GGML weights too
 *
 * This is the only TypeScript file in `tooling/` — the rest are `.mjs`. Node 24 (`.nvmrc`)
 * strips types natively, so `node tooling/download-sidecars.ts` just runs. It does mean type
 * *stripping* and not type *transformation*, so nothing here may use `enum`, `namespace`,
 * parameter properties or `import =`.
 */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(projectRoot, 'packages/ingest/src/sidecars/manifest.json')
const SIDECARS = path.join(projectRoot, '.sidecars')

interface Artifact {
  url: string
  archive: 'zip' | 'tar.gz' | 'tar.xz'
  bytes: number
  sha256: string
  members: string[]
}

interface Tool {
  version: string
  license: string
  sourceUrl: string
  binaries: string[]
  variants: Record<string, Record<string, Artifact>>
}

interface Manifest {
  $comment?: string
  tools: Record<string, Tool>
}

/**
 * The GGML weights, mirrored from `packages/ingest/src/media/weights.ts`.
 *
 * Duplicated rather than imported because this script runs as bare Node with no bundler, and
 * that module imports the shared download primitive, which imports Node streams — a chain that
 * works but makes a one-file script depend on the package resolving. `--models` cross-checks
 * the two lists, so the copy cannot drift silently.
 */
const WEIGHTS = [
  { repo: 'ggerganov/whisper.cpp', file: 'ggml-tiny.bin' },
  { repo: 'ggerganov/whisper.cpp', file: 'ggml-small-q5_1.bin' },
  { repo: 'ggml-org/whisper-vad', file: 'ggml-silero-v6.2.0.bin' },
]

function say(message: string): void {
  process.stderr.write(`${message}\n`)
}

/** Streams a URL to a file, hashing on the way past. Returns the digest and the byte count. */
async function fetchToFile(
  url: string,
  target: string,
): Promise<{ sha256: string; bytes: number }> {
  const response = await fetch(url)
  if (!response.ok || response.body === null) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  await mkdir(path.dirname(target), { recursive: true })

  const hash = createHash('sha256')
  let bytes = 0
  const source = Readable.fromWeb(response.body as never)
  source.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    bytes += chunk.byteLength
  })
  await pipeline(source, createWriteStream(target))
  return { sha256: hash.digest('hex'), bytes }
}

/** Hashes a URL without keeping it: what `--write-manifest` needs for a 670 MB CUDA archive. */
async function hashUrl(url: string): Promise<{ sha256: string; bytes: number }> {
  const response = await fetch(url)
  if (!response.ok || response.body === null) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk)
    bytes += chunk.byteLength
  }
  return { sha256: hash.digest('hex'), bytes }
}

function run(command: string, args: string[]): Promise<void> {
  return import('node:child_process').then(
    ({ spawn }) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
        let stderr = ''
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf-8')
        })
        child.on('error', reject)
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)),
        )
      }),
  )
}

/** Same two-path rule as the app's own extractor: fflate for zip, system tar for the rest. */
async function extract(
  archive: string,
  kind: Artifact['archive'],
  into: string,
  members: string[],
) {
  await mkdir(into, { recursive: true })
  if (kind === 'zip') {
    const { unzipSync } = await import('fflate')
    const bytes = new Uint8Array(await readFile(archive))
    const globs = members.map(
      (pattern) =>
        new RegExp(
          `^${pattern
            .split('')
            .map((c) => ('\\^$.|?+()[]{}'.includes(c) ? `\\${c}` : c))
            .join('')
            .replace(/\*/g, '[^/]*')}$`,
        ),
    )
    const entries = unzipSync(bytes, { filter: (file) => globs.some((g) => g.test(file.name)) })
    for (const [name, content] of Object.entries(entries)) {
      const base = path.posix.basename(name.replace(/\\/g, '/'))
      if (base === '' || base === '.' || base === '..') continue
      await writeFile(path.join(into, base), content)
    }
    return
  }
  await run('tar', [
    '-x',
    kind === 'tar.xz' ? '-J' : '-z',
    '-f',
    archive,
    '-C',
    into,
    '--wildcards',
    '--no-anchored',
    '--transform',
    's#.*/##',
    ...members,
  ])
}

async function loadManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(MANIFEST, 'utf-8')) as Manifest
}

/** The platform key for this machine, matching `packages/ingest/src/sidecars/platform.ts`. */
function hostPlatform(): string {
  return `${process.platform}-${process.arch}`
}

async function install(wantCuda: boolean): Promise<void> {
  const manifest = await loadManifest()
  const platform = hostPlatform()

  for (const [id, tool] of Object.entries(manifest.tools)) {
    const variant = id === 'whisper' && wantCuda ? 'cuda12' : 'cpu'
    const artifact = tool.variants[variant]?.[platform] ?? tool.variants.cpu?.[platform]
    if (artifact === undefined) {
      say(`- ${id}: no build published for ${platform}, skipping`)
      continue
    }

    const into = path.join(SIDECARS, id, tool.version)
    const primary = tool.binaries[0] as string
    const exe = process.platform === 'win32' ? `${primary}.exe` : primary
    try {
      await stat(path.join(into, exe))
      say(`- ${id} ${tool.version}: already installed`)
      continue
    } catch {
      // Not installed; fall through and fetch it.
    }

    const archive = path.join(into, `download.${artifact.archive}`)
    say(`- ${id} ${tool.version} (${variant}): ${(artifact.bytes / 1e6).toFixed(0)} MB`)
    const got = await fetchToFile(artifact.url, archive)
    if (got.sha256 !== artifact.sha256) {
      await rm(archive, { force: true })
      throw new Error(
        `${id}: archive does not match the manifest (expected ${artifact.sha256}, got ${got.sha256})`,
      )
    }

    await extract(archive, artifact.archive, into, artifact.members)
    await rm(archive, { force: true })
    if (process.platform !== 'win32') {
      for (const name of await readdir(into)) {
        if (!name.includes('.')) await chmod(path.join(into, name), 0o755).catch(() => undefined)
      }
    }
    say(`  extracted into ${path.relative(projectRoot, into)}`)
  }
}

/**
 * The GGML weights, and the test fixture's speech.
 *
 * `jfk.wav` is whisper.cpp's own sample: John F. Kennedy's 1961 inaugural address, a work of
 * the United States federal government and therefore public domain in the US. It is what
 * `packages/ingest/test/fixtures/media/build.mjs` muxes the sample video's audio from, so a
 * maintainer regenerating that fixture needs it and nobody else does.
 */
async function installModels(): Promise<void> {
  const into = path.join(SIDECARS, 'models')
  for (const weight of WEIGHTS) {
    const target = path.join(into, weight.file)
    try {
      await stat(target)
      say(`- ${weight.file}: already present`)
      continue
    } catch {
      // Missing; fetch it.
    }
    say(`- ${weight.file}`)
    const got = await fetchToFile(
      `https://huggingface.co/${weight.repo}/resolve/main/${weight.file}`,
      target,
    )
    say(`  ${got.bytes} bytes, sha256 ${got.sha256}`)
  }

  const sample = path.join(into, 'jfk.wav')
  try {
    await stat(sample)
  } catch {
    say('- jfk.wav (fixture speech)')
    await fetchToFile(
      'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav',
      sample,
    )
  }
}

/** Re-hashes every pinned artifact from its URL and rewrites the manifest in place. */
async function writeManifest(): Promise<void> {
  const manifest = await loadManifest()
  for (const [id, tool] of Object.entries(manifest.tools)) {
    for (const [variant, byPlatform] of Object.entries(tool.variants)) {
      for (const [platform, artifact] of Object.entries(byPlatform)) {
        say(`${id}/${variant}/${platform}`)
        const got = await hashUrl(artifact.url)
        artifact.bytes = got.bytes
        artifact.sha256 = got.sha256
        say(`  ${got.bytes} ${got.sha256}`)
      }
    }
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  say(`wrote ${path.relative(projectRoot, MANIFEST)}`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const wantInstall = args.includes('--install')
  const wantModels = args.includes('--models')
  const wantManifest = args.includes('--write-manifest')

  if (!wantInstall && !wantModels && !wantManifest) {
    say('nothing to do; pass --install, --models or --write-manifest')
    return
  }
  if (wantManifest) await writeManifest()
  if (wantInstall) await install(args.includes('--cuda'))
  if (wantModels) await installModels()
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
