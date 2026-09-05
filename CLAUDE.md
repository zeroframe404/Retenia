# CLAUDE.md

Retenia is a local-first desktop learning & memory app (Electron + React + TypeScript). Windows 11 is the first target platform. Status: pre-alpha bootstrap — no application code exists yet.

## Commands

- `pnpm i` — install workspace dependencies
- `pnpm dev` — run all apps in dev mode (Turborepo)
- `pnpm build` — build all packages/apps
- `pnpm test` — run all unit tests (Vitest)
- `pnpm test --filter <pkg>` — run tests for one workspace package, e.g. `pnpm test --filter @retenia/core`
- `pnpm typecheck` — TypeScript project-wide typecheck
- `pnpm lint` — Biome lint + format check over the repo, then per-package lint
- `pnpm licenses:check` — dependency license allowlist check
- `pnpm run schema:check` — Claude strict-mode dry run of the activity JSON Schemas against the fixtures
- `pnpm e2e` — Playwright end-to-end tests (Electron, via `_electron`)
- `pnpm storybook` — component catalog

## Monorepo map

- `apps/desktop` — the Electron app (main, preload, renderer)
- `packages/core` — domain logic, zero Electron/Node/provider deps
- `packages/db` — SQLite schema, migrations, repositories (better-sqlite3)
- `packages/ipc-contract` — zod schemas for every main↔renderer IPC channel
- `packages/ui` — shared React components + Storybook
- `packages/activity-schema` — zod envelope + payload families, the 98-type registry, per-type rules, JSON Schema export, fixtures
- `packages/activity-graders` — pure graders per family (text, numeric, ordering metrics); returns `GradeResult` for core's `toRating`
- `packages/activities` — activity renderers (React host + Storybook); wires schema and graders
- `packages/activity-ai` — AI graders for activities: the versioned P10 rubric prompt, its structured output, the injection guard and the offline fallback
- `packages/editor` — note/content editor
- `packages/readers` — document/media readers (PDF, EPUB, …)
- `packages/ai` — AI provider adapters, behind ports (AI SDK 7)
- `packages/ingest` — content ingestion pipelines
- `packages/importers` — external format importers
- `packages/i18n` — i18n resources (`es-AR` default, `en` second)
- `packages/config` — base tsconfig, `biome.json` and Tailwind preset shared by every package
- `tooling/` — release, signing, sidecar and model-download scripts, plus repo hygiene checks

## Conventions

- Global conventions: @docs/spec/00-conventions.md
- Architecture decisions log: @docs/spec/01-decisions.md

The rest of the product specification lives in `docs/spec/` and is **not** imported here —
pull in only the file a task needs, to keep context small:

| File | Covers |
|---|---|
| `docs/spec/02-memory-system.md` | FSRS-6 formulas and defaults, importance levels, exams, metrics, SQL model, scheduler interfaces |
| `docs/spec/03-activities.md` | The 98 activity types, rating strategies, 22 payload families, activity engine |
| `docs/spec/04-path-generation.md` | 10-stage generation pipeline, QA gates, JSON schemas, prompts P1–P11, diagnostic |
| `docs/spec/05-ingestion-rag.md` | Per-source ingestion strategy, OCR, embeddings, hybrid retrieval |
| `docs/spec/06-ai-providers.md` | Provider matrix and prices, structured outputs, voice, media, budgets |
| `docs/spec/07-architecture.md` | Stack versions, monorepo rules, Electron security, data layer, import/export, risks |
| `docs/spec/07a-schema.md` | Generated listing of the SQLite schema (tables, columns, FKs, indexes, checks, triggers), pragmas, migration policy — regenerate with `pnpm --filter @retenia/db schema:doc` |
| `docs/spec/08-ux.md` | UX principles, screen map, gamification |
| `docs/spec/09-feature-catalog.md` | The 125 features with MVP/V1/V2/Later tags |
| `docs/spec/10-glossary.md` | Glossary and primary sources |

Source of all of them: `docs/research/Retenia_Investigacion_y_Plan_Maestro.pdf`.

The specs also reference a companion `prompts.md` (the 76 sub-phase prompts). It lives
outside this repository — do not look for it here.

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

## Subagents

- Use the `reviewer` subagent at the end of each phase against the relevant `docs/spec/*.md` file, to check every requirement is implemented and edge cases are tested.
- Use the `tester` subagent when a module needs Vitest (or Playwright E2E) coverage written against a list of edge cases.
- Use the `security-reviewer` subagent before merging any change that touches Electron main/preload/IPC code or AI provider integrations, to audit contextIsolation, CSP, IPC validation, secrets handling, and prompt-injection surfaces.
- Use the `explorer` subagent for quick read-only "where is X" / "which files reference Y" lookups instead of manual grepping.

## Commit etiquette

- Conventional Commits (`feat(memory): …`, `fix(db): …`).
- One logical change per commit. Never commit secrets or `.env*` files.
- Claude commits only when explicitly asked to in the prompt.

## Windows

Hooks in `.claude/hooks/` are bash scripts run via Git Bash. Install **Git for Windows** and make sure `jq` is on `PATH` (the hooks fall back to `node` if it is missing) for them to parse tool-call JSON. There is no non-bash fallback: without Git Bash the hooks do not run at all, so `guard.sh` will not be blocking anything.

## MCP

`.mcp.json` declares the project-scoped MCP servers: **github** (issues/PRs) and
**playwright** (app screenshots). Claude Code asks for approval the first time it loads
them. No secrets live in the file — `github` reads `${GITHUB_TOKEN}` from the environment,
so export a fine-grained PAT (repo, issues, pull requests) before starting a session, or
skip the server. Add per-user servers such as Context7 with `claude mcp add --scope user`.

## Compacting

When compacting, preserve the list of modified files and the test commands used to verify them.
