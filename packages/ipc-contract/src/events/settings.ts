import { z } from 'zod'
import { defineEvents } from '../define'

/** Broadcast after every `settings.set`, so every window (and every `useSetting` reader in
 *  this one) picks up a change made from anywhere else. */
export const settingsEvents = defineEvents({
  'settings.changed': z.object({ key: z.string(), value: z.json() }),
})
