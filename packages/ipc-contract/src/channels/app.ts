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
})
