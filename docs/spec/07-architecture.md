Source: Retenia research PDF v1.0 (Sep 2026), sections 10 and 14

# Technical architecture

Verified stack (npm versions and dates as of 1-Sep-2026), monorepo structure, security, data,
background processing, code sandboxes, import/export, signing and distribution, quality and
risks. Section 14 (costs, risks and open decisions) is folded in at the end because it is the
programme-level counterpart of the technical risk table.

## Table of contents

- [1. Process map](#1-process-map)
- [2. Recommended stack](#2-recommended-stack)
- [3. Monorepo](#3-monorepo)
- [4. Electron foundation](#4-electron-foundation)
- [5. Data layer](#5-data-layer)
- [6. Future sync](#6-future-sync)
- [7. Background processing and sidecars](#7-background-processing-and-sidecars)
- [8. Code sandboxes](#8-code-sandboxes)
- [9. Import and export](#9-import-and-export)
- [10. Quality, CI and release](#10-quality-ci-and-release)
- [11. Technical risks and mitigations](#11-technical-risks-and-mitigations)
- [12. Estimated effort](#12-estimated-effort)
- [13. Costs, risks and open decisions (section 14)](#13-costs-risks-and-open-decisions-section-14)

---

## 1. Process map

**Figure 10.1** — The app's processes and their boundaries.

### Renderer · Chromium 152 · sandbox + CSP · served from `app://`

| Area | Contents |
|---|---|
| UI | React 19 · TanStack Router/Query · Zustand · Tailwind 4 · shadcn (Base UI) · Motion · Rive · i18next |
| Editors and readers | Tiptap 3 (cloze, math, occlusion) · EmbedPDF · foliate-js · video player with overlays · wavesurfer + VAD |
| Activity engine | 98 types / 22 families · ActivityHost · DET/FUZ/CAS graders · Storybook |
| Web Workers and iframes | Pyodide · QuickJS · sql.js · Mermaid · Transformers.js (WebGPU) · sandboxed iframe for HTML/H5P |

▲ `contextBridge → window.api` (typed IPC contract with zod) · push events
(`webContents.send` / `MessagePort`) ▼

### Main · Node 24 (ESM) · sole writer of the database

| Area | Contents |
|---|---|
| IPC router + windows | validated handlers · multi-window · tray · notifications · deep links `retenia://` |
| SQLite | better-sqlite3 · WAL · FTS5 · sqlite-vec · Drizzle + migrations · backups · blobs by hash |
| Job queue | `jobs` table · `utilityProcess` pool · piscina · progress, cancellation, retries |
| AI gateway | AI SDK 7 · roles smart/cheap/vision/audio/embed/local · budget · cost log · fallback |
| Secrets and updates | `safeStorage` (DPAPI/Keychain) · electron-updater · fuses · electron-log · Sentry |
| Protocols | `app://` (renderer) · `media://blob/<sha256>` with Range (video/audio/PDF) |
| Domain core (`packages/core`) | FSRS (ts-fsrs) · sessions · importance · exams · gamification · analytics · 0 Electron deps |

### Utility processes and sidecars · background ingestion

| Area | Contents |
|---|---|
| Node extractors | pdf.js · mammoth · epub · pptx · sharp · Tesseract.js · Defuddle · youtube-transcript |
| C++ sidecars (processes) | ffmpeg (LGPL build) · whisper-cli / sherpa-onnx (CPU/CUDA) · yt-dlp only as an optional plugin |
| Embeddings and models | Transformers.js (EmbeddingGemma, bge-m3) · ONNX/GGML models in `userData/models` · FSRS optimizer (binding) |
| Cloud (the user's keys) | Claude Sonnet 5 / Opus 5 · Gemini 3.7 Flash / Flash-Lite · Azure Speech (PA, STT, TTS) · ElevenLabs · Nano Banana 2 · FLUX.2 · Recraft · OpenRouter |
| Optional local AI | Ollama `:11434` · LM Studio `:1234` (OpenAI-compatible) · RTX 4070 Super · qwen3.5:9b · gemma4:12b |
| Commercial backend (future) | accounts · licences · payments (MercadoPago/Stripe) · AI proxy · sync (PowerSync or Evolu) · spoken over fetch + outbox, without touching the core |

## 2. Recommended stack

| Area | Choice (version) | Why | Alternative |
|---|---|---|---|
| Runtime | Electron 44.1.1 (Chromium 152, Node 24.19) | One single Chromium; Node for ingestion; native modules with prebuilds | Tauri 2 (discarded: WebKit on Mac, Rust backend, two runtimes for ingestion) |
| Build | electron-vite 5 | Vite + HMR; isolated entry points; optional bytecode | Forge 7 + Vite plugin |
| Packaging / updates | electron-builder 26.15 + electron-updater 6.8 (GitHub Releases → generic server later) | NSIS, differential blockmaps, latest/beta channels, `verifyUpdateCodeSignature` | Forge + Squirrel |
| Windows signing | Certum Cloud Code Signing Individual (~USD 139/year, no token) or SSL.com IV/OV (65–75/year) + eSigner (20/month) | Available to an individual in Argentina; eSigner has a CLI and a GitHub Action for CI | Azure Artifact Signing (USD 9.99/month) not available to individuals outside the US/Canada; EV no longer gives instant SmartScreen reputation |
| IPC | Own typed contract + zod (~150 lines) | Zero dependencies, native Structured Clone, validation in main | trpc-electron (fork for tRPC 11); electron-trpc is on tRPC 10 and has had no releases for 21 months |
| UI | React 19.2 + TanStack Router 1.170 + TanStack Query 5.102 + Zustand 5 | Typed routes and search params; Query wraps `window.api`; `<Activity>` to keep the player mounted | React Router 8, Jotai |
| Style and components | Tailwind 4.3 + shadcn/ui on Base UI 1.7 (default since Jul-2026) + Motion 13 + Rive 4.33 + dotLottie + canvas-confetti | "Linear/Duolingo" polish; mascot with state machines; OKLCH tokens; dark mode synced with the OS | Radix, React Aria, Mantine 9, Ark UI 5 |
| Notes editor | Tiptap 3.31 (MIT) + own extensions (cloze, math, occlusion, callout) + `@tiptap/markdown` + `static-renderer` | Custom nodes, Markdown round-trip, Yjs-ready; nothing Pro required | BlockNote 0.54 (MPL + paid XL), Lexical, Plate |
| Code and mathematics | CodeMirror 6 (default) + lazy Monaco (IDE); KaTeX 0.18 + MathLive 0.110 | Weight vs IntelliSense; math input with a virtual keyboard | — |
| PDF / EPUB | EmbedPDF 2.15 (MIT, PDFium WASM, annotations) + pdfjs-dist 6 (text in Node) + `@hyzyla/pdfium`; vendored foliate-js | Highlights → cards; page rendering for OCR | react-pdf; epub.js; Nutrient (commercial, discarded) |
| Video / audio | media-chrome 4 (or Vidstack 1.x if its activity is confirmed) + own overlay layer; wavesurfer.js 7 + RecordPlugin + Silero VAD | Markers, pause-and-ask, VTT subtitles from Whisper, clip to card, waveform and recording | video.js 8 |
| Occlusion and diagrams | Konva 10 + react-konva; Mermaid 11.17 (in a worker/iframe, `securityLevel: strict`); Excalidraw 0.18 (local fonts) | Declarative editor; serializable JSON | Fabric 7; tldraw (watermark) |
| Data | better-sqlite3 13 (N-API prebuilds) + Drizzle 0.45 → 1.0 + FTS5 + sqlite-vec 0.1.9 + WAL | Synchronous in main, extensions, versioned SQL migrations | Kysely; LanceDB if > 200k chunks; `node:sqlite` **(unverified)** in Electron 44 |
| Encryption | better-sqlite3-multiple-ciphers (optional) + `safeStorage` (DPAPI / Keychain) | AES-256 at rest; keys never in the renderer | keytar has been abandoned since 2022 |
| Scheduler | ts-fsrs 5.4 + standard FSRS-6 | `@open-spaced-repetition/binding` (optimizer in a worker) | fsrs-browser (WASM) |
| Jobs | `utilityProcess` + piscina 5 + `jobs` table in SQLite | Persistent progress, cancellation and retries; orphans re-queued at startup | BullMQ (requires Redis: no) |
| Media tooling | Bundled LGPL ffmpeg build (not `ffmpeg-static`, which is GPL-3), yt-dlp binary with auto-update only as an optional plugin, whisper-cli (CPU/CUDA) or sherpa-onnx | Clean licences; no Python in v1 | faster-whisper sidecar (v2) |
| Local embeddings | `@huggingface/transformers` 4.2 (WebGPU/ONNX) or Ollama | Quantized e5/bge/EmbeddingGemma; GPU without CUDA via WebGPU/DirectML | onnxruntime-node directly |
| AI | Vercel AI SDK 7.0.x + official providers + openai-compatible + OpenRouter | One API, structured output, tools, costs | Native SDKs |
| Sandboxes | Pyodide 314 (Python 3.14 in WASM, MPL-2.0), QuickJS-WASM, sql.js, `iframe sandbox srcdoc` for HTML/CSS (Sandpack with a self-hosted bundler if React/Vue is needed) | Offline, no licences | WebContainers (commercial licence), isolated-vm (maintenance mode), Judge0/Piston (server) |
| Quality | TypeScript 7.0 (Go compiler; stable programmatic API in 7.1) + Biome 2.5 + Vitest 4 + Playwright 1.62 (`_electron`) + Storybook 10 | Fast and modern; Biome does not depend on the TS API | ESLint 10 with `@typescript/typescript6` |
| Observability | Sentry Electron 7 + electron-log 5 + opt-in PostHog | Minidumps, rotating logs, aggregated events with no content | — |
| i18n / repo | i18next 26 + react-i18next 17 (`es-AR` default, ICU plurals); pnpm 11 workspaces + Turborepo 2.10 | Namespaces per feature; build cache | Lingui 6; Nx |

## 3. Monorepo

```
retenia/
  apps/desktop/            # electron-vite: src/main, src/preload, src/renderer; electron-builder.yml
  packages/
    core/                  # pure domain: entities, FSRS (ts-fsrs), grading, gamification,
                           # analytics; ports (repos, clock, ids); zod. 0 Electron deps
    db/                    # Drizzle schema + SQL migrations + better-sqlite3 repos (Node adapter);
                           # future: expo-sqlite / sqlite-wasm / powersync
    ipc-contract/          # typed IPC channels (zod in/out) and push events
    ui/                    # design system: Tailwind tokens, shadcn (Base UI), Motion presets,
                           # icons, Rive/Lottie wrappers
    activities/            # activity-schema, activity-graders, activity-ui, activity-ai,
                           # activity-speech, activity-code (+ Storybook)
    editor/                # Tiptap kit (cloze/math/occlusion/callout), Markdown round-trip,
                           # static renderer
    readers/               # pdf (EmbedPDF), epub (foliate-js), video (player + overlays),
                           # audio (wavesurfer)
    ai/                    # AI SDK providers, routing by role, versioned prompts, pricing,
                           # budgets, keys (interface)
    ingest/                # extractors, chunking, embeddings, jobs (Node only), sidecar manager
                           # (ffmpeg / whisper / yt-dlp)
    importers/             # anki, remnote, obsidian, csv; exporters markdown / apkg
    i18n/  config/         # es-AR/en resources; base tsconfig, biome.json, tailwind preset
  tooling/                 # release, signing, sidecar and model download scripts
```

**Allowed dependencies:** `core` imports nothing internal; `db`, `ai`, `ingest`, `importers`
import `core`; `ui`, `activities`, `editor`, `readers` import `core` (types) and `ui`;
`apps/desktop` imports everything. A future Expo or web client reuses `core`, `ai`,
`activities` and `editor` with a different `db` adapter.

## 4. Electron foundation

**Cadence:** one major every ~8 weeks (40.0 on 16-Jan, 44.0 on 25-Aug); the last three are
supported. Pin the major per release and test startup in CI on Windows.

**Auto-update:** `github` provider (draft release → publish) with `latest.yml`/`beta.yml`;
blockmaps for differential downloads; `quitAndInstall`; `generic` provider to migrate to your
own server without touching the client.

**macOS later:** DMG/ZIP separated by architecture (native modules complicate `lipo`),
notarization with `@electron/notarize` and an App Store Connect API key; Apple Developer USD
99/year.

### Security checklist (official)

- `contextIsolation` and `sandbox` on, `nodeIntegration` off, no `@electron/remote`.
- Minimal preload with `contextBridge.exposeInMainWorld('api', …)` (never raw `ipcRenderer`).
- Validate `event.senderFrame` in every handler.
- Strict CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src` with a
  provider allowlist from settings, plus `http://127.0.0.1:11434` and `:1234`.
- Renderer served from `app://` (privileged scheme, not `file://`).
- `will-navigate` blocked and `setWindowOpenHandler → deny`.
- `setPermissionRequestHandler` that only allows `media` (microphone) to the `app://` origin.
- Fuses: `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`,
  `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`.
- Untrusted content (H5P, HTML previews, Sandpack) in an `<iframe sandbox>` of a different
  origin without the preload.

### IPC pattern

`packages/ipc-contract` defines
`{ 'cards.review': { input: z.object(…), output: z.object(…) } }`; main registers
`ipcMain.handle(channel, (e, raw) => handler(schema.parse(raw)))`; the preload generates `api`
from the contract; TanStack Query wraps `window.api.*` with invalidation from main's events
(`api.events.on('cards.changed', …)`); main → renderer push with `webContents.send` or
`MessageChannelMain` for streams (transcription, LLM tokens).

### Windows, deep links, media

Main window + secondary windows (pop-out player, exam mode) as clients of the same API;
`app.setAsDefaultProtocolClient('retenia')` + single instance (`retenia://import?src=…`,
`retenia://review`, future OAuth); `protocol.handle('media', …)` with `net.fetch` over
`file://` (supports Range for seeking), mapping `media://blob/<sha256>` →
`userData/blobs/ab/cd/…` with anti-traversal validation; FS only in main/utility; drag & drop
with `webUtils.getPathForFile`.

### Performance

Aggressive lazy loading (Monaco ~5 MB gz, Excalidraw, pdf.js, Pyodide 10+ MB, Mermaid, KaTeX
fonts) per route/activity; workers with onnxruntime + model (+300–600 MB) are created on
demand and killed; a "disable GPU acceleration" toggle; reference memory: main 60–90 MB, React
renderer 80–120 MB + GPU 50 MB; Monaco + pdf.js + video simultaneously can reach 500–800 MB.

## 5. Data layer

**Operation pragmas:**

```sql
PRAGMA journal_mode=WAL; synchronous=NORMAL; foreign_keys=ON; busy_timeout=5000;
cache_size=-64000; temp_store=MEMORY;
```

A single writer (main or a "db worker"); workers return results by message.

**Backups:** online `db.backup()` daily and on close, rotation of 7 in `userData/backups/`,
"Export a copy" (zip of DB + blobs), weekly `integrity_check`, a warning if `userData` is in a
folder synced by OneDrive/Dropbox.

**Layout:** `userData/retenia.db` (+ wal/shm), `blobs/<sha256[0:2]>/<sha256>.ext`
(content-addressed: free dedupe, integrity, trivial future sync), `cache/` (regenerable),
`models/` (ONNX/GGUF downloaded with a hash), `bin/` (updatable sidecars), `backups/`,
`logs/`. Windows: `path.join`, short names by hash (MAX_PATH), NFC in imported names, atomic
replacement, close the DB before updating.

**Sync-ready conventions:** UUIDv7 ids (text, sortable), `created_at`/`updated_at` (ms),
`deleted_at` (soft delete), `device_id`, `version` per row, no AUTOINCREMENT, JSON in TEXT with
`json_valid`, blobs outside the DB, an `outbox` table empty in v1.

### Tables

| Table | Key fields |
|---|---|
| `sources` · `source_units` · `chunks` · `embeddings` (vec0) · `annotations` | `kind`, `title`, `origin_uri`, `blob_sha256`, `status`, `language`, `meta` · page/slide/keyframe/segment with `t_start`/`t_end` · `text`, `char_start/end`, `token_count`, `hash` (+ `chunks_fts`) · `embedding float[N]`, `model_id`, partition `source_id` · highlight/note/region/clip with an `anchor` (rects/CFI/t) |
| `knowledge_items` · `cards` · `review_logs` · `scheduler_profiles` · `importance_levels` | See §5 of the memory spec (FSRS fields 1:1 with `ts-fsrs`) |
| `paths` · `sections` · `modules` · `lessons` · `activities` · `attempts` · `lesson_sessions` | Path tree with `version`, `unlock_rule`, `xp_reward`; `activities` with `type`/`family`/`config`/`grading` JSON; `attempts` with `score`, `answer`, `feedback`, `ai_eval_call_id`; sessions with `xp` and `accuracy` |
| `exams` · `exam_items` · `exam_attempts` · `item_bank` | Blueprint, forms A/B, `difficulty_logit`, `exposure`, `stats` |
| `jobs` · `ai_calls` · `settings` · gamification (`xp_events`, `streaks`, `achievements`) · `blobs` · `outbox` | `status`/`priority`/`payload`/`progress`/`attempts`/`run_after`/`locked_by` · `provider`/`model`/`purpose`/tokens (input, output, cached, reasoning)/`cost_usd`/`latency` · `key`/`value` JSON · append-only events → aggregates · `sha256`/`mime`/`bytes` · (empty in v1) |

## 6. Future sync

**Least regret:** no library in v1; `packages/core` with pure use cases
(`reviewCard(cardId, rating, now)`) over the interfaces `CardRepository`, `Clock`,
`IdGenerator`.

**Candidates when the time comes:** PowerSync (SQLite on the client over better-sqlite3,
Postgres backend, Node SDK in beta, Apache-2.0; your backend stays yours) or Evolu (MIT, own
CRDT, E2E encryption, self-hosted relay; but it demands its schema from day 1).

**Discarded:** Zero (no offline writes), cr-sqlite (dormant), Triplit (AGPL), Jazz (model
lock-in), Electric (would duplicate the engine with PGlite). Yjs/Automerge only for
collaboration in the editor.

## 7. Background processing and sidecars

`utilityProcess.fork()` for heavy jobs (parsing, embeddings, spawning binaries),
`worker_threads` + piscina for pure CPU, `child_process.spawn` with `windowsHide` and
kill-tree.

**Persisted queue:**

```sql
UPDATE jobs SET status='running', locked_by=?
WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_after<=?
            ORDER BY priority DESC, created_at LIMIT 1)
RETURNING *;
```

Progress by messages → `webContents.send('jobs:progress')`; cancellation with
`AbortController`; backoff of 2ⁿ minutes; a "Processing" panel with a bar per source.

**Binaries:** LGPL ffmpeg in `resources/bin` with `asarUnpack` (invoked as a process, with a
notice and a link to the sources: it does not contaminate the licence); pre-compiled
whisper-cli (CPU + CUDA, detect the NVIDIA GPU) with GGML models downloaded on demand
(`nodejs-whisper` compiles at postinstall with MinGW: unacceptable for end users); yt-dlp only
as an optional plugin with weekly auto-update and SHA256 verification.

**Keyframes:** `-vf "select='gt(scene,0.3)'"` or `fps=1/10` + dHash.

**Python sidecar (PyInstaller) deferred to v2:** +300 MB–2 GB, antivirus false positives,
signing hundreds of DLLs.

## 8. Code sandboxes

| Case | Solution | Notes |
|---|---|---|
| Python | Pyodide 314 (CPython 3.14 in WASM, MPL-2.0) in a Web Worker with a timeout | ~10–15 MB core + on-demand packages (numpy, pandas, SymPy); pre-bundle wheels for offline; a mini assert runner (pytest works but is slow) |
| HTML/CSS/JS ("HTML & CSS" route) | `<iframe sandbox srcdoc>` + CodeMirror for pure HTML/CSS; Sandpack 2.20 for React/Vue with a self-hosted bundler (by default it loads from codesandbox.io) | Grading: compare the DOM and computed styles with rules |
| JS/TS with tests | QuickJS-WASM (`quickjs-emscripten`, MIT) with a memory limit and an `interruptHandler` | isolated-vm in maintenance mode; WebContainers requires a commercial licence |
| SQL | sql.js (SQLite WASM) with per-exercise fixtures; compare result-sets | — |
| C, Java, Go, Rust | Local toolchain detected (`where gcc/java/go`) in a temporary cwd with timeouts; marked "advanced" | No real sandbox on Windows; acceptable because the code is the user's own. Judge0 (GPL) / Piston (MIT) / E2B in the version with a backend |

## 9. Import and export

### Anki `.apkg`

- **Legacy 1:** `collection.anki2`, schema 11, JSON in `col`.
- **Legacy 2:** `collection.anki21` (+ dummy).
- **Latest:** `collection.anki21b` compressed with zstd, schema 18 with
  `notetypes`/`fields`/`templates`/`decks` tables, protobuf config, `media` protobuf
  `MediaEntries`.

**Strategy:** import Legacy 2 first (Anki offers "Support older Anki versions" when
exporting), then anki21b with `fzstd` + `protobufjs` (a small message copied from
`import_export.proto`); read `notes` (fields separated by `\x1f`), `cards`, `revlog` (→
`review_logs` with an SM-2 → FSRS conversion or "relearn"); support templates `{{Field}}`,
`{{cloze:}}`, `{{hint:}}`, `{{type:}}`, conditionals, `[sound:]`, `[latex]`. Exporting our own
`.apkg` (Legacy 2) is ≈ 300 lines (genanki-js is AGPL: do not use).

### RemNote

Exports "RemNote (complete)" JSON, OPML, Anki `.apkg`, HTML, Markdown, Text, PDF; import the
`.apkg` (reliable for cards) + OPML/Markdown for the hierarchy; the complete JSON requires
reverse engineering with a real export (undocumented).

### Obsidian / Markdown

Frontmatter (`gray-matter`), wikilinks and embeds, callouts, tags; Spaced Repetition plugin
syntax: `Pregunta::Respuesta`, `:::` reverse, multi-line with `?`/`??`, cloze `==texto==` or
`{{1::respuesta::pista}}`, decks by tag `#flashcards/…`, scheduling in a comment
`<!--SR:!2025-01-01,3,250-->`.

**Own export:** one folder per path/module, one `.md` per item with frontmatter, cloze
`{{c1::…}}`, media in `attachments/` by hash.

### CSV/TSV, H5P, SCORM

Guided column mapping with a preview; `h5p-standalone` 3.8 (MIT) in a sandboxed iframe
capturing xAPI; `scorm-again` 3.3 (MIT) to play SCORM 1.2/2004/cmi5 in B2B; packaging our own
lessons as SCORM/xAPI is left for later.

## 10. Quality, CI and release

- TypeScript strict with `tsc` 7 for typecheck and Biome for lint/format.
- Vitest 4 + RTL with **100 % of `core`'s logic** (FSRS, grading, sessions) covered.
- Storybook 10 with one story per activity type × state (idle/correct/incorrect) and optional
  visual regression.
- Playwright 1.62 with `_electron.launch` over the packaged app (silent NSIS install → launch
  → review → close) on a Windows runner.
- GitHub Actions with a `windows-latest` matrix (build NSIS + signing with the secrets
  `CSC_LINK`/`CSC_KEY_PASSWORD` or eSigner credentials) and `macos-latest` afterwards.
- Releases as drafts; beta/latest channels with a "Receive betas" toggle.
- Sentry (main, renderer, utility; source maps; incompatible with bytecode); electron-log with
  "Export diagnostics"; opt-in PostHog with an anonymous id and no content; feature flags in
  `settings`.
- Licence audit with `license-checker` (allowlist MIT/Apache/BSD/ISC/MPL) in CI.

## 11. Technical risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Native modules (better-sqlite3, sharp, onnxruntime, sqlite-vec) when Electron is upgraded | Build fails / crash | Prefer N-API; `@electron/rebuild` only for what is not N-API; pin the major; `asarUnpack`; startup test in CI |
| Signing / SmartScreen | Users frightened in the first week | Certificate from the first beta; the same cert for years; sign ffmpeg/whisper-cli too; a download page with instructions |
| Antivirus (unsigned NSIS, CUDA DLLs, binaries) | Installation blocked | Signing; sidecars downloaded on demand; submit samples to Microsoft; no Python sidecar in v1 |
| Size (Monaco, Pyodide, models 100 MB–1.5 GB, CUDA 500 MB) | Installer of 300 MB+ | Lazy loading; models and sidecars in `userData` with a hash; an optional "GPU package" |
| GPU (drivers, black screens, missing WebGPU) | Render crash / slow inference | Acceleration toggle; feature detection with a WASM/CPU fallback |
| Vidstack with uncertain status; EmbedPDF 3.0, Drizzle 1.0, electron-vite 6, sqlite-vec pre-v1 with breaking changes; AI SDK with a major every ~6 months | Migration work | Thin wrappers; `save-exact`; grouped monthly Renovate; all AI usage encapsulated in `packages/ai`; official codemods |
| TypeScript 7 without a stable programmatic API until 7.1 | Broken lint | Biome; or `@typescript/typescript6` for typescript-eslint |
| Contaminating licences (ffmpeg-static GPL-3, genanki-js AGPL, tldraw watermark, BlockNote XL, commercial WebContainers, h5p-server GPL, PyMuPDF AGPL) | Product not commercializable | Avoided in the stack table; automatic audit in CI |
| SQLite corruption (power cuts, OneDrive over `%APPDATA%`) | Data loss | WAL + backups + `integrity_check` + a synced-folder warning |
| Key security (DPAPI does not protect against malware of the same user) | Key theft | Document it; a spending budget; an optional master passphrase (Argon2) that encrypts keys + DB |
| Late sync | Rewrite | UUIDv7, soft deletes, outbox and repositories behind ports from day 1; an early PowerSync spike |
| Memory in long sessions (video + PDF + editor + workers) | OOM | Recycle utility processes; `<Activity>` to unmount heavy views; opt-in monitoring |

## 12. Estimated effort

| Area | Person-weeks | Area | Person-weeks |
|---|---|---|---|
| Electron skeleton (vite, builder, NSIS, updater, signing, CSP, IPC, protocols, logging, Sentry, CI) | 2–3 | Monorepo + design system (tokens, shadcn, dark mode, Motion, icons, Storybook) | 2–3 |
| Data layer (schema, migrations, repos, FTS5, sqlite-vec, backups, jobs) | 2–3 | Domain core (FSRS, queues, gamification, analytics, tests) | 2–3 |
| Tiptap editor (cloze, math, occlusion, callouts, Markdown round-trip) | 3–4 | Paths, lessons and activities (21 types + grading + Storybook) | 5–7 |
| PDF reader with highlights → cards; EPUB | 2–3 | Interactive video (player, markers, pause-and-ask, subtitles, clips) | 3–4 |
| Audio and pronunciation (recording, waveform, VAD, Azure, accent lab) | 2–3 | Ingestion (extractors, chunking, embeddings, ffmpeg/whisper, keyframes) | 4–6 |
| RAG + AI (providers, routing, structured output, costs, budgets, keys) + "Generate with AI" | 5–7 | Code sandboxes (Pyodide, QuickJS, HTML/CSS preview, sql.js, Parsons) | 3–4 |
| Importers/exporters | 2–3 | Exams, notifications, statistics, gamification, onboarding, i18n | 4–5 |
| E2E Playwright + hardening + beta | 2–3 | macOS (signing, notarization, arm64/x64, QA) | 1–2 |
| **Total v1 (Windows), 1 senior developer with AI support** | **≈ 40–55** | **Usable MVP** (review + editor + PDF + basic generated paths) | **≈ 12–16** |

## 13. Costs, risks and open decisions (section 14)

### 13.1 Fixed development and distribution costs

| Item | USD | When | Notes |
|---|---|---|---|
| Code signing certificate (Certum Cloud Individual) | ≈ 139 / year | Before the first public beta | Alternative SSL.com IV/OV 65–75/year + eSigner 20/month to sign from CI. Azure Artifact Signing not available to individuals in Argentina. |
| Apple Developer Program | 99 / year | Phase 14 (macOS) | Notarization and distribution outside the App Store. |
| Domain `retenia.app` / `.io` | ≈ 15–40 / year | When you fix the name | Verify WHOIS and trademark (INPI). |
| Azure AI Speech | 0 (F0) → usage | Phase 11 | F0: 5 h/month of STT/PA and 0.5M characters of TTS; S0 for production. |
| Claude Code (subscription or API) | depends on the plan | The whole development | The Fable 5.1 and UltraCode sub-phases consume the most; they are reserved for foundational decisions and sweeps. |
| AI accounts with prepaid credits | 20–50 / month | From phase 7 | Anthropic + Google AI Studio (paid) + Azure; OpenRouter optional to try Chinese models without opening accounts. |
| GitHub (private repo, Actions) | 0–4 / month | Phase 0 | Windows runners consume minutes faster; releases as drafts. |
| Sentry / PostHog | 0 (free tiers) | Phase 1 / 13 | Only with real users. |

### 13.2 Monthly AI operating cost (summary)

| Scenario | USD / month | Composition |
|---|---|---|
| Light use (1 path/month, daily review, little voice) | ≈ 6–12 | Sonnet 5 batch + Gemini Flash + Azure inside the free tier + local |
| Recommended intensive use (2 paths, 30 lessons, 500 gradings, 300 chats, 7–15 h of voice, 100 images) | ≈ 20–34 | Text 9–14 + voice 6–14 + media 5–6 + light video 0.20 |
| Premium (Opus 5 on paths, Pro images, Mistral OCR, real-time voice) | ≈ 45–70 | Without generative video |
| With 2 minutes of generative video per month | + 25–45 | Opt-in only, with a visible per-clip cost |

### 13.3 Main risks

| Risk | Probability · impact | Mitigation |
|---|---|---|
| Volatility of prices and models (Gemini ×2 in 2027; DeepSeek ×10 in August; deprecations of Imagen 4, Sora, gpt-image-1.5) | High · medium | Versioned and editable pricing table in the app; interchangeable provider layer; budget with alerts; re-verify quarterly. |
| Insufficient pedagogical quality of the generation (shallow, recall-only, hallucinations) | Medium · high | QA gates (faithfulness per claims, coverage, Bloom variety, pedagogy judge), editable preview, "Report an error" with a citation, an own eval of 50 items in Spanish. |
| Scope too large for one person | High · high | Phased plan with usable milestones; MVP in 12–16 weeks; V2/Later designed but not built; UltraCode for sweeps. |
| Copyright of sources (Udemy, YouTube, books) | Medium · medium | Local processing, no redistribution, no yt-dlp in the base product, clear terms; the user supplies their files. |
| Privacy: sources leave to APIs | Medium · medium | Default providers that do not train on the data (Anthropic, paid Google), a "provider X only" option, optional PII redaction, local mode. |
| Signing, SmartScreen and antivirus | High · medium | Certificate from the first beta; the same cert; sidecars downloaded on demand; no Python in v1. |
| Synchronization debt when commercializing | Medium · high | Sync-ready schema and repositories behind ports from F3; an early PowerSync spike. |
| Imperfect pronunciation assessment outside `en-US` (no prosody, no IPA) and no `en-IE` | High · medium | Layered Accent Lab; show "intelligibility" not "accent"; ELSA/SpeechSuper as an upgrade for English; local GOP in v2. |
| Gamification fatigue or a perception of an "electronic whip" | Medium · low | Sober mode; never punish; limited notifications; visible substance metrics. |
| Unstable dependencies (Vidstack, sqlite-vec pre-v1, EmbedPDF 3, TS 7 API, AI SDK majors) | High · low | Thin wrappers, exact versions, monthly Renovate, codemods. |

### 13.4 Open decisions (to be taken during development)

1. **Name and brand:** Retenia is a working name; verify WHOIS and search INPI before
   registering the domain and designing the logo.
2. ~~**FSRS optimizer:** `@open-spaced-repetition/binding` (napi, verify the win32-x64 prebuild)
   vs `fsrs-browser` (WASM, no native binaries).~~ **Taken in sub-phase 4.6:**
   `@open-spaced-repetition/binding`. The win32-x64 prebuild exists and is shipped as an
   `optionalDependencies` entry, so no build toolchain and no `@electron/rebuild` (it is
   N-API). `fsrs-browser` is not needed as the fallback: the same package publishes
   `@open-spaced-repetition/binding-wasm32-wasi` behind the *same* API, pulled in by
   `supportedArchitectures.cpu: ['current', 'wasm32']` in `pnpm-workspace.yaml`, so a
   platform with no prebuild degrades to WASM without a second adapter. Measured on a
   5,000-review fixture: ~500 ms to train, log loss 0.378 → 0.356.
3. **Video player:** media-chrome (safe) vs Vidstack 1.x (better React API, uncertain
   activity): decide in sub-phase 6.4 after reviewing commits.
4. **Local Whisper:** sherpa-onnx (one addon for STT + VAD + TTS) vs a bundled whisper-cli (no
   compilation): decide in 6.4 based on ease of packaging with CUDA.
5. **Default embeddings:** EmbeddingGemma (better Spanish, 300M) vs multilingual-e5-small
   (faster on CPU): measure in 6.3 with your corpus.
6. **Reference locale for accents:** `en-GB` vs `en-US` for the segmental scoring of the Irish
   "Accent Lab" (`en-US` gives NBest and prosody; `en-GB` has closer vowels).
7. **Premium tier:** whether Opus 5 is offered as a per-path option ("high quality", ≈ 2× the
   cost) or only to explain errors.
8. **Future sync:** PowerSync (your own Postgres backend) vs Evolu (E2E, its own schema):
   decide before the commercial layer; the F3 schema is compatible with both.
9. **Light video:** whether Remotion (free for individuals) is included in v1 or left for V2.
10. **Telemetry:** opt-in PostHog from the beta, or only Sentry until there are users.

### 13.5 What to re-verify before fixing prices or depending on it

All of the following are **(unverified)**:

- DeepSeek's official pricing page (it served different content): confirm USD 0.22/0.66
  off-peak and 0.44/1.32 peak (V4 Flash), max output 384K.
- OpenAI's long-context multipliers (> 272K tokens: 2× input / 1.5× output) and the price of
  Flex.
- gpt-image-2 per image (OpenAI only publishes USD 30/M output tokens); Ideogram (404 page);
  Veo 3.1 Lite and Seedance 2.0 (third parties).
- ElevenLabs' credits ↔ characters relationship per model; `en-IE` voice names; Gemini TTS
  prices in Cloud.
- Azure: phoneme name format outside `en-US`; whether the prosody add-on is charged in F0; the
  list of regions with Pronunciation Assessment; the behaviour of content assessment in the
  current SDK.
- DeepL Free (500k characters/month) and Pro; Marker v2 (commercial licence threshold USD 2M
  vs 5M); MiniMax and PlayHT (prices not public).
- Gemini's free tier (RPM/RPD per model is no longer published in the docs: look at the AI
  Studio dashboard).
- The real status of `node:sqlite` in Electron 44; the DirectML/CUDA EP in onnxruntime-node
  1.29; the version and status of faster-whisper, promptfoo, papaparse,
  `@mozilla/readability`.
- The behaviour of Certum SimplySign in unattended CI; the internal structure of the "RemNote
  complete" export.
- Argentine tax withholdings on purchases of AI credits in foreign currency and the acceptance
  of local cards in each console (Stripe 3DS/AVS).
- Real throughput of Qwen3.5 9B / Gemma 4 12B / Parakeet / whisper-turbo on the RTX 4070 Super
  (all the figures are extrapolations).
- Meta-analysis figures quoted from memory (Rowland 2014, Adesope 2017; Mizumoto & Eguchi
  2023) before using them in marketing.
- RemNote: "Flashcards 2.0" and "Look Back" do not appear under those names in the help or the
  changelog; SuperMemo: details of Sleep Chart, Tasklist and Advanced English (pages returning
  403).
