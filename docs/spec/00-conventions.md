# Conventions

## Global conventions

- Language of code, comments, commits and docs: **English**. UI strings live in i18n resources (`es-AR` default, `en` second).
- Package manager **pnpm 11**, monorepo with **Turborepo**. TypeScript **strict**, ESM everywhere (AI SDK 7 is ESM-only). Lint/format with **Biome**. Tests with **Vitest 4**; E2E with **Playwright** (`_electron`); component catalog with **Storybook 10**.
- Commits: Conventional Commits (`feat(memory): …`), one logical change per commit, never commit secrets. Claude commits only when the prompt says so.
- Every new module ships with tests and, for UI, a Storybook story. Every IPC channel is declared in `packages/ipc-contract` with zod schemas.
- `packages/core` never imports Electron, Node `fs`, or any provider SDK. Domain logic depends on ports (`Clock`, `IdGenerator`, repositories).
- Ids are **UUIDv7** strings; every table has `created_at`, `updated_at`, `deleted_at` (soft delete), `version`; JSON columns are `TEXT` with `json_valid` checks; blobs live outside the DB, content-addressed by sha256.
- FSRS fields on `cards` and `review_logs` mirror `ts-fsrs` 1:1. Importance levels: `urgent | high | normal | maintenance | paused`.
- Nothing destructive without confirmation; never `git push --force`; never edit `migrations/` that were already applied — write a new migration.
