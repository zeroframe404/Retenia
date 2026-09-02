import { z } from 'zod'
import { defineEvents } from '../define'

/**
 * A parsed `retenia://` URL (docs/spec/07-architecture.md §4). `import` carries the source
 * to ingest, `review` jumps straight to today's session, `authCallback` is reserved for a
 * future OAuth flow (`retenia://auth/callback`).
 *
 * `retenia://…` is invocable from any web page (`app.setAsDefaultProtocolClient`), so `src`
 * is constrained to http(s) here too — mirroring the check in
 * `apps/desktop/src/main/deep-links/parse.ts` — rather than left as a bare `z.string()`: this
 * is what `api.events.on('app.deepLink', …)` validates against on the renderer side.
 */
export const deepLinkSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('import'),
    // A prefix check, not `new URL(value).protocol`: this package targets no particular
    // runtime (no DOM lib, no Node types — see tsconfig.json), and the full parse already
    // happens on the producing side (`apps/desktop/src/main/deep-links/parse.ts`). This is
    // the defense-in-depth layer, so ruling out the dangerous prefixes (`file:`,
    // `javascript:`, `data:`, a bare local/UNC path) is enough.
    src: z.string().refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
      message: 'src must be an http(s) URL',
    }),
  }),
  z.object({ kind: z.literal('review') }),
  z.object({ kind: z.literal('authCallback'), params: z.record(z.string(), z.string()) }),
])

export type DeepLink = z.infer<typeof deepLinkSchema>

/**
 * electron-updater lifecycle, broadcast by `apps/desktop/src/main/updates/updater.ts` on
 * every state change (docs/spec/07-architecture.md §10). `error` carries only a message —
 * an update failure is not fatal, so the renderer just logs and lets the next scheduled
 * check retry.
 */
export const updateStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checking') }),
  z.object({ status: z.literal('not-available') }),
  z.object({ status: z.literal('available'), version: z.string() }),
  z.object({ status: z.literal('downloading'), percent: z.number().min(0).max(100) }),
  z.object({ status: z.literal('downloaded'), version: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type UpdateStatus = z.infer<typeof updateStatusSchema>

/** Push events main sends to the renderer for the `app` domain. */
export const appEvents = defineEvents({
  'app.themeChanged': z.object({
    theme: z.enum(['light', 'dark']),
  }),
  /** Parsed by `apps/desktop/src/main/deep-links/parse.ts` and broadcast on receipt. */
  'app.deepLink': deepLinkSchema,
  'app.updateStatus': updateStatusSchema,
})
