# CLAUDE.md

Retenia is a local-first desktop learning & memory app (Electron + React + TypeScript). Windows 11 is the first target platform. Status: pre-alpha bootstrap — no application code exists yet.

## Commands

- `pnpm i` — install workspace dependencies
- `pnpm dev` — run all apps in dev mode (Turborepo)
- `pnpm build` — build all packages/apps
- `pnpm test` — run all unit tests (Vitest)
- `pnpm test --filter <pkg>` — run tests for one workspace package, e.g. `pnpm test --filter @retenia/core`
- `pnpm typecheck` — TypeScript project-wide typecheck
- `pnpm lint` — Biome lint + format check
- `pnpm e2e` — Playwright end-to-end tests (Electron, via `_electron`)
- `pnpm storybook` — component catalog

## Monorepo map

- `apps/desktop` — the Electron app (main, preload, renderer)
- `packages/core` — domain logic, zero Electron/Node/provider deps
- `packages/db` — SQLite schema, migrations, repositories (better-sqlite3)
- `packages/ipc-contract` — zod schemas for every main↔renderer IPC channel
- `packages/ui` — shared React components + Storybook
- `packages/activities` — learning activity types/engines
- `packages/editor` — note/content editor
- `packages/readers` — document/media readers (PDF, EPUB, …)
- `packages/ai` — AI provider adapters, behind ports (AI SDK 7)
- `packages/ingest` — content ingestion pipelines
- `packages/importers` — external format importers
- `packages/i18n` — i18n resources (`es-AR` default, `en` second)
- `packages/config` — shared runtime/app configuration
- `tooling/` — shared build, lint, and TS configs

## Conventions

- Global conventions: @docs/spec/00-conventions.md
- Architecture decisions log: @docs/spec/01-decisions.md

## Domain rules

Not inferrable from the code — follow exactly:

- Ids are **UUIDv7** strings, never v4 or autoincrement.
- No hard deletes: rows are soft-deleted via `deleted_at`, never `DELETE`d.
- FSRS fields on `cards`/`review_logs` mirror `ts-fsrs` 1:1 — don't rename or reshape them.
- `packages/core` has **zero** Electron, Node, or AI-provider SDK imports; it depends only on ports (`Clock`, `IdGenerator`, repository interfaces).
- All main↔renderer communication goes through `packages/ipc-contract` with zod-validated schemas, never raw `ipcMain.handle`/`ipcRenderer.invoke` payloads.
- `better-sqlite3` is only ever imported in the main or a utility process, never in the renderer.
- CSP is strict in the renderer: no `unsafe-inline`, no remote script sources.
- Secrets (API keys, tokens) are only ever stored via Electron's `safeStorage`, in the main process — never in renderer state, localStorage, or plain files.

## Commit etiquette

- Conventional Commits (`feat(memory): …`, `fix(db): …`).
- One logical change per commit. Never commit secrets or `.env*` files.
- Claude commits only when explicitly asked to in the prompt.

## Windows

Hooks in `.claude/hooks/` are bash scripts run via Git Bash. Install **Git for Windows** and make sure `jq` is on `PATH` for the hooks to parse tool-call JSON. `.cmd` fallbacks sit next to each `.sh` for shells without `bash`, but they're best-effort — Git Bash is the supported path.

## Compacting

When compacting, preserve the list of modified files and the test commands used to verify them.
