---
name: release
description: Manual release checklist for cutting a Retenia desktop release — version bump, changelog, build, sign, installer smoke test, draft publish, and auto-update verification. Invoke explicitly with /release; not auto-triggered.
disable-model-invocation: true
---

# Release checklist

Manual process only — run through each step in order, don't skip ahead.

1. **Bump version.** Update the version in `package.json` (root and any versioned packages/apps that ship independently). Follow semver; confirm with the user which bump (patch/minor/major) if not already specified.
2. **Changelog.** Add a new entry summarizing user-facing changes since the last release, grouped by type (Added / Fixed / Changed).
3. **Build.** Run `pnpm build` for all packages/apps. Confirm a clean build with no errors.
4. **Sign.** Sign the Windows installer artifact per the project's signing setup (certificate/tooling as configured for `apps/desktop`).
5. **Smoke test the installer.** Install the freshly built, signed installer on a clean or representative Windows 11 environment. Launch the app, confirm it opens, confirm core flows work (create a note/card, run a review).
6. **Publish a draft release.** Create the release as a **draft** (not public) with the built artifacts and changelog attached, for final review before going live.
7. **Verify auto-update from the previous version.** Install the previous released version, trigger an update check, and confirm the app updates cleanly to the new version without data loss.

Only after all seven steps pass should the draft release be published/promoted — that final publish step is a separate, explicit human action, not part of this checklist.
