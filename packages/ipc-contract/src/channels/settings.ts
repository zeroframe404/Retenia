import { z } from 'zod'
import { defineContract } from '../define'

/**
 * A generic window onto `SettingsRepository` (`packages/core/src/ports/
 * settings-repository.ts`), for every registered key that does not already have its own
 * dedicated `app.*` channel (theme, density, telemetry, locale, gamification profile and
 * the update channel keep going through those — see `./app.ts` — since they are also read
 * very early in startup, before this generic path is wired up). `key` is left as a plain
 * string rather than a duplicated enum of every `SettingsKey`: main validates it against the
 * real registry and fails the call for anything it does not recognize, the same way an
 * out-of-range value degrades to the setting's default rather than crashing.
 *
 * There is no separate `settings.subscribe` channel: a request/response `invoke` cannot
 * stay open, so "subscribe" is the push event below (`settings.changed`) plus
 * `useSetting`'s `useIpcEvent` subscription on the renderer side
 * (`apps/desktop/src/renderer/src/settings/use-setting.ts`).
 */
export const settingsChannels = defineContract({
  'settings.get': {
    input: z.object({ key: z.string().min(1) }),
    output: z.object({ value: z.json() }),
  },
  'settings.set': {
    input: z.object({ key: z.string().min(1), value: z.json() }),
    output: z.object({ value: z.json() }),
  },
})
