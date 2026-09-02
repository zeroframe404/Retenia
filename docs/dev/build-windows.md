# Building the Windows installer locally

Sub-phase 1.4 (docs/spec/07-architecture.md §4/§10) wires up electron-builder, auto-update,
logging and opt-in crash reporting. This is how to build and smoke-test the result on a
Windows machine.

## Prerequisites

- Windows 11.
- Node 24 and pnpm 11 (`corepack enable`).
- A full `pnpm i` from the repo root.

## Build

```
pnpm --filter @retenia/desktop build
```

This runs `electron-vite build` (main/preload/renderer bundles into `apps/desktop/out`)
followed by `electron-builder --win --publish never`. The result lands in
`apps/desktop/dist/`:

- `Retenia-<version>-win32-<arch>.exe` — the NSIS installer.
- `latest.yml` (or `beta.yml` for a prerelease version) — the electron-updater feed file.
  Present even though nothing was published; it's generated at build time.
- `win-unpacked/` — the unpacked app, useful for a quick `electron-builder --dir`-style run
  without installing.

No code-signing certificate exists yet (that's sub-phase 14.3), so the `.exe` is unsigned:
expect a SmartScreen "unknown publisher" warning on first run, and note that
`win.verifyUpdateCodeSignature: true` in `electron-builder.yml` has no effect until a
signed build exists to check downloaded updates against.

## Install and verify

1. Run the generated `.exe`. It is a one-click, per-user installer
   (`allowToChangeInstallationDirectory: false`) — it installs and launches without
   prompting for a location.
2. Confirm the app window opens.
3. Confirm logging is working: `%APPDATA%\Retenia\logs\main.log` should contain at least
   the process's startup lines (electron-log rotates this file at 10 MB, keeping one
   `.old` copy).
4. Confirm the settings placeholder exists: `%APPDATA%\Retenia\settings.json` should have
   been created with `{ "updateChannel": "latest", "telemetryEnabled": false }`.
5. Confirm update events reach the renderer: open DevTools (if using an unpacked/dev
   build) and watch the console for `[update] { status: ... }` lines — the app checks for
   updates 10 seconds after launch and every 6 hours after that. Against a repository with
   no releases yet, expect `checking` followed by `error` (404) rather than
   `not-available`; that is expected until the first GitHub Release exists.
6. Uninstall via "Add or remove programs" and confirm it removes cleanly.

## Publishing a release

`.github/workflows/release.yml` runs `pnpm --filter @retenia/desktop run release`
(`electron-vite build && electron-builder --win --publish always`) on `windows-latest`,
using the workflow's own `GITHUB_TOKEN` to publish a **draft** GitHub Release. Owner/repo
are not hardcoded in `electron-builder.yml` — electron-builder reads them from the
`repository` field in `apps/desktop/package.json`. The update channel (`latest` vs `beta`)
is decided by whether the version being published carries a prerelease tag (e.g.
`0.4.0-beta.1`), not by an env var.

## Known gaps until later sub-phases

- **Signing** (sub-phase 14.3): once a certificate exists, `CSC_LINK`/`CSC_KEY_PASSWORD`
  (or eSigner) get wired into `release.yml`, and `verifyUpdateCodeSignature` starts
  actually checking something.
- **macOS** (sub-phase 14.5): `electron-builder.yml`'s `mac` section is prepared but
  inert — nothing here invokes `electron-builder --mac`.
- **Sentry**: `initSentryMain` only sends anything once `SENTRY_DSN` is set at build time
  *and* the user has opted in via `app.setTelemetryEnabled` (default off). Neither the env
  var nor an onboarding opt-in screen exist yet, so crash reporting is wired but dormant
  until both land.
