import { z } from 'zod'
import { defineContract } from '../define'

/** Which electron-updater feed the app checks: `latest` for stable, `beta` for the
 * "Receive betas" opt-in (docs/spec/07-architecture.md §10). */
export const updateChannelSchema = z.enum(['latest', 'beta'])
export type UpdateChannel = z.infer<typeof updateChannelSchema>

export const settingsSchema = z.object({
  updateChannel: updateChannelSchema,
  telemetryEnabled: z.boolean(),
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
  /** Manually trigger an update check outside the launch/6h cadence (e.g. a "Check now" button). */
  'app.checkForUpdates': {
    input: z.void(),
    output: z.void(),
  },
  /** Restarts the app to apply a downloaded update. Only meaningful after `updateStatus`
   * has reported `downloaded`; the renderer is expected to confirm with the user first.
   * Currently unreachable: the updater doesn't auto-download until the app is code-signed
   * (`apps/desktop/src/main/updates/updater.ts`), and nothing calls `downloadUpdate()` yet
   * either, so `downloaded` never fires. Don't wire a "Restart to update" button to this
   * until one of those lands. */
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
