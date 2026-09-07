/**
 * The LGPL/notice obligations `docs/dev/sidecars.md` records but never surfaced anywhere the
 * shipped app itself carries (`docs/spec/07-architecture.md` §7: "The LGPL obligation … is
 * discharged in `docs/dev/sidecars.md` **and in the app's third-party notices**").
 *
 * A short, hand-maintained list rather than anything generated from `pnpm licenses list`: that
 * tool reads npm package metadata, and every entry here is exactly what it cannot see — a
 * binary fetched at runtime (ffmpeg, whisper.cpp), a native shared library a dependency loads
 * dynamically (libvips, via `@huggingface/transformers` → sharp), or source vendored straight
 * into the tree (foliate-js). `ThirdPartyNotices` (`./third-party-notices-section.tsx`) is
 * where a user actually finds this; `docs/dev/sidecars.md` is where a developer does.
 */
export interface ThirdPartyNotice {
  /** Shown as the entry's heading. */
  name: string
  /** SPDX identifier. */
  license: string
  /** One sentence: how it is used, and why that keeps its licence off Retenia's own code. */
  detail: string
  /** Where the same binary/library — or, for LGPL, its source — can be obtained. */
  sourceUrl: string
}

export const THIRD_PARTY_NOTICES: readonly ThirdPartyNotice[] = [
  {
    name: 'ffmpeg',
    license: 'LGPL-3.0-or-later',
    detail:
      'Run as a separate process, spawned with an argument array and never linked into the application — the LGPL configuration published by BtbN/FFmpeg-Builds, unmodified.',
    sourceUrl: 'https://github.com/BtbN/FFmpeg-Builds',
  },
  {
    name: 'whisper.cpp',
    license: 'MIT',
    detail: 'Local speech transcription (whisper-cli), run as a separate process.',
    sourceUrl: 'https://github.com/ggml-org/whisper.cpp',
  },
  {
    name: 'libvips',
    license: 'LGPL-3.0-or-later',
    detail:
      "An unmodified prebuilt shared library, loaded dynamically by @huggingface/transformers' image pipeline (a transitive dependency of the local-embeddings package; Retenia's own features embed and rerank text only).",
    sourceUrl: 'https://github.com/libvips/libvips',
  },
  {
    name: 'foliate-js',
    license: 'MIT',
    detail:
      'Two modules (epub.js, epubcfi.js) vendored unmodified for EPUB parsing and CFI handling — see packages/readers/src/epub/vendor/foliate-js/README.md.',
    sourceUrl: 'https://github.com/johnfactotum/foliate-js',
  },
]
