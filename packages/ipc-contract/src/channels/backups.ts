import { z } from 'zod'
import { defineContract } from '../define'

export const backupSummarySchema = z.object({
  /** Absolute path in main's filesystem — display-only, the renderer never opens it
   *  directly. */
  file: z.string(),
  createdAt: z.iso.datetime(),
  bytes: z.int().nonnegative(),
})
export type BackupSummary = z.infer<typeof backupSummarySchema>

/**
 * Backups of `userData/retenia.db` (`docs/spec/07-architecture.md` §5): an automatic daily
 * + on-quit snapshot with 7-deep rotation, a manual "Export copy" (DB + blobs, zipped), and
 * "Restore from backup".
 */
export const backupsChannels = defineContract({
  /** What the settings screen's "Backups" section renders. */
  'backups.status': {
    input: z.void(),
    output: z.object({
      backups: z.array(backupSummarySchema),
      /** `userData` looks like it sits inside a OneDrive/Dropbox/Google Drive folder —
       *  `docs/spec/07-architecture.md` §11's SQLite-corruption risk. */
      syncedFolderWarning: z.boolean(),
    }),
  },
  /** Forces an out-of-cadence backup (a "Back up now" button). */
  'backups.backupNow': {
    input: z.void(),
    output: z.object({ file: z.string() }),
  },
  /** Prompts for a save location, then zips a fresh DB snapshot plus every blob into it. */
  'backups.exportCopy': {
    input: z.void(),
    output: z.object({ savedTo: z.string().nullable() }),
  },
  /**
   * Prompts for a `.db` backup file, swaps it in for the live database, then quits and
   * relaunches. `restored: false` means the user cancelled the file picker — nothing
   * changed and the app keeps running.
   */
  'backups.restoreFromBackup': {
    input: z.void(),
    output: z.object({ restored: z.boolean() }),
  },
})
