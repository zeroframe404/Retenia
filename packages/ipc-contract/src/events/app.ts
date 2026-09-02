import { z } from 'zod'
import { defineEvents } from '../define'

/**
 * A parsed `retenia://` URL (docs/spec/07-architecture.md §4). `import` carries the source
 * to ingest, `review` jumps straight to today's session, `authCallback` is reserved for a
 * future OAuth flow (`retenia://auth/callback`).
 */
export const deepLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('import'), src: z.string() }),
  z.object({ kind: z.literal('review') }),
  z.object({ kind: z.literal('authCallback'), params: z.record(z.string(), z.string()) }),
])

export type DeepLink = z.infer<typeof deepLinkSchema>

/** Push events main sends to the renderer for the `app` domain. */
export const appEvents = defineEvents({
  'app.themeChanged': z.object({
    theme: z.enum(['light', 'dark']),
  }),
  /** Parsed by `apps/desktop/src/main/deep-links/parse.ts` and broadcast on receipt. */
  'app.deepLink': deepLinkSchema,
})
