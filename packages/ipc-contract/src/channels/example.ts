import { z } from 'zod'

/**
 * Shape every IPC channel follows (see `.claude/skills/add-ipc-channel/SKILL.md`):
 * a literal channel name plus zod input/output schemas main and preload both import,
 * so a payload is validated at the boundary in both directions.
 *
 * This one is a placeholder wired end to end in sub-phase 1.2 alongside the real
 * `ipcMain.handle`/preload/TanStack Query plumbing — it exists now so the contract
 * package, its naming convention (`domain.action`), and its test have real content.
 */
export const appPing = {
  channel: 'app.ping' as const,
  input: z.object({
    sentAt: z.iso.datetime(),
  }),
  output: z.object({
    receivedAt: z.iso.datetime(),
  }),
}
