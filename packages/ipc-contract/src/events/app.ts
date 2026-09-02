import { z } from 'zod'
import { defineEvents } from '../define'

/** Push events main sends to the renderer for the `app` domain. */
export const appEvents = defineEvents({
  'app.themeChanged': z.object({
    theme: z.enum(['light', 'dark']),
  }),
})
