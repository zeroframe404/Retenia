import { z } from 'zod'
import { defineContract } from '../define'

/** Which electron-updater feed the app checks: `latest` for stable, `beta` for the
 * "Receive betas" opt-in (docs/spec/07-architecture.md §10). */
export const updateChannelSchema = z.enum(['latest', 'beta'])
export type UpdateChannel = z.infer<typeof updateChannelSchema>

/** The user's theme preference. `system` follows the OS (`nativeTheme.shouldUseDarkColors`
 * in main); `app.themeChanged` always carries the *resolved* `light`/`dark` value, never
 * `system` itself (docs/spec/08-ux.md §5). */
export const themePreferenceSchema = z.enum(['light', 'dark', 'system'])
export type ThemePreference = z.infer<typeof themePreferenceSchema>

/** Compact (Linear-style, adults) vs. comfortable (wide, animated — school students),
 * docs/spec/08-ux.md §1 principle 5 "configurable density". */
export const densitySchema = z.enum(['compact', 'comfortable'])
export type Density = z.infer<typeof densitySchema>

/** `arcade` is full Duolingo-style gamification; `sober` keeps streaks/goals/mastery but
 * hides XP, mascot, quests and leagues (docs/spec/08-ux.md §4 "Sober mode"). Only the XP
 * badge visibility is wired up in this phase — the rest lands with gamification (13.1). */
export const gamificationProfileSchema = z.enum(['arcade', 'sober'])
export type GamificationProfile = z.infer<typeof gamificationProfileSchema>

export const settingsSchema = z.object({
  updateChannel: updateChannelSchema,
  telemetryEnabled: z.boolean(),
  theme: themePreferenceSchema,
  density: densitySchema,
  gamification: z.object({ profile: gamificationProfileSchema }),
})
export type Settings = z.infer<typeof settingsSchema>

/**
 * The `app` domain: things the renderer needs to know about the running application.
 *
 * Channels are named `domain.action` (see `.claude/skills/add-ipc-channel/SKILL.md`).
 */
export const appChannels = defineContract({
  'app.getVersion': {
    input: z.void(),
    output: z.object({
      app: z.string(),
      electron: z.string(),
      chrome: z.string(),
      node: z.string(),
    }),
  },
  'app.ping': {
    input: z.object({
      sentAt: z.iso.datetime(),
    }),
    output: z.object({
      sentAt: z.iso.datetime(),
      receivedAt: z.iso.datetime(),
    }),
  },
  /**
   * Dev-only: copies `resources/dev/sample.ogg` into the blob store and returns its
   * `media://` URL, so the renderer can prove Range/seeking works against a real file
   * (sub-phase 1.3). Resolves to `null` in a packaged build.
   */
  'app.devMediaSampleUrl': {
    input: z.void(),
    output: z.object({
      url: z.string().nullable(),
    }),
  },
  /**
   * The settings this sub-phase actually persists (`apps/desktop/src/main/settings/store.ts`).
   * A placeholder for the real `settings` table landing in sub-phase 3.5 — everything else
   * (AI keys, budgets, providers, …) still lives nowhere.
   */
  'app.getSettings': {
    input: z.void(),
    output: settingsSchema,
  },
  /** Which electron-updater feed (`latest.yml` vs `beta.yml`) to check against. */
  'app.setUpdateChannel': {
    input: z.object({ channel: updateChannelSchema }),
    output: settingsSchema,
  },
  /** Opt-in Sentry crash reporting (main, renderer, utility); off until the user consents. */
  'app.setTelemetryEnabled': {
    input: z.object({ enabled: z.boolean() }),
    output: settingsSchema,
  },
  /** Sets `nativeTheme.themeSource`; main resolves `system` and broadcasts the concrete
   * result on `app.themeChanged`, same as an OS-level theme switch does. */
  'app.setTheme': {
    input: z.object({ theme: themePreferenceSchema }),
    output: settingsSchema,
  },
  /** The shell's compact/comfortable layout density. */
  'app.setDensity': {
    input: z.object({ density: densitySchema }),
    output: settingsSchema,
  },
  /** The gamification profile (arcade/sober); the shell reads this to hide the XP badge. */
  'app.setGamificationProfile': {
    input: z.object({ profile: gamificationProfileSchema }),
    output: settingsSchema,
  },
  /** Manually trigger an update check outside the launch/6h cadence (e.g. a "Check now" button). */
  'app.checkForUpdates': {
    input: z.void(),
    output: z.void(),
  },
  /** Restarts the app to apply a downloaded update. Only meaningful after `updateStatus`
   * has reported `downloaded`; the renderer is expected to confirm with the user first. */
  'app.quitAndInstall': {
    input: z.void(),
    output: z.void(),
  },
  /**
   * Prompts for a save location, then zips the log files plus `process.getSystemVersion()`
   * and GPU info into it. `savedTo` is `null` when the user cancels the save dialog.
   */
  'app.exportDiagnostics': {
    input: z.void(),
    output: z.object({
      savedTo: z.string().nullable(),
    }),
  },
  /**
   * The renderer has no Sentry SDK of its own — the preload only ever exposes this
   * generated contract, never a second bridge — so an uncaught error or rejection is
   * reported here instead, and main's already-initialized Sentry client
   * (`src/main/observability/sentry.ts`) decides whether to send it.
   */
  'app.reportRendererError': {
    input: z.object({
      name: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    }),
    output: z.void(),
  },
})
