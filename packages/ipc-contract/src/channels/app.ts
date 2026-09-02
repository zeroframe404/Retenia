import { z } from 'zod'
import { defineContract } from '../define'

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
})
