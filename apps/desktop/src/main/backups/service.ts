import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ZipArchive } from 'archiver'
import type { Database } from 'better-sqlite3'
import { log } from '../logging/log'
import { backupFileName, isBackupFileName, selectBackupsToPrune } from './naming'

/** Kept newest-first; the seventh-oldest and everything older is pruned after each backup
 *  (task 3.5's "rotation (7)"). */
const KEEP_BACKUPS = 7
/** "Daily" and "weekly", in milliseconds — checked against a last-run timestamp on launch
 *  rather than a timer, since the app is not expected to stay open across the boundary. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_WEEK_MS = 7 * ONE_DAY_MS

export interface BackupSummary {
  file: string
  createdAt: string
  bytes: number
}

export interface BackupService {
  /** Online `db.backup()` to a fresh timestamped file, then prune down to the newest 7.
   *  Returns the file's absolute path. */
  backupNow(): Promise<string>
  list(): Promise<BackupSummary[]>
  /** Zips a fresh backup of the database alongside every blob into `destinationZipPath`,
   *  streamed rather than buffered in memory (`archiver`, same as diagnostics export). */
  exportCopy(destinationZipPath: string): Promise<void>
  /** `PRAGMA integrity_check`; `'ok'` or the list of problems it reported. */
  runIntegrityCheck(): 'ok' | string
}

export interface BackupServiceOptions {
  /** The raw better-sqlite3 handle backups are taken from. */
  sqlite: Database
  backupsRoot: string
  blobsRoot: string
  clock?: { now(): Date }
}

export function createBackupService({
  sqlite,
  backupsRoot,
  blobsRoot,
  clock = { now: () => new Date() },
}: BackupServiceOptions): BackupService {
  async function prune(): Promise<void> {
    const names = existsSync(backupsRoot) ? await readdir(backupsRoot) : []
    const toDelete = selectBackupsToPrune(names, KEEP_BACKUPS)
    await Promise.all(toDelete.map((name) => unlink(join(backupsRoot, name)).catch(() => {})))
  }

  return {
    async backupNow() {
      await mkdir(backupsRoot, { recursive: true })
      const dest = join(backupsRoot, backupFileName(clock.now()))
      // better-sqlite3's online backup API: safe against a concurrent writer (unlike
      // `cp`/`copyFile` of a live WAL database), and does not block the connection for
      // longer than each internal step.
      await sqlite.backup(dest)
      await prune()
      return dest
    },

    async list() {
      if (!existsSync(backupsRoot)) return []
      const names = (await readdir(backupsRoot)).filter(isBackupFileName)
      const summaries = await Promise.all(
        names.map(async (name) => {
          const full = join(backupsRoot, name)
          const info = await stat(full)
          return { file: full, createdAt: info.mtime.toISOString(), bytes: info.size }
        }),
      )
      return summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    async exportCopy(destinationZipPath) {
      await mkdir(backupsRoot, { recursive: true })
      // A fresh, consistent snapshot rather than the live file: the live `.db` can be
      // mid-write, and its `-wal`/`-shm` siblings are meaningless outside the original
      // directory.
      const snapshot = join(backupsRoot, `.export-${Date.now()}.db`)
      await sqlite.backup(snapshot)
      try {
        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(destinationZipPath)
          const archive = new ZipArchive({ zlib: { level: 9 } })
          output.on('close', resolve)
          archive.on('error', reject)
          archive.pipe(output)
          archive.file(snapshot, { name: 'retenia.db' })
          if (existsSync(blobsRoot)) {
            archive.directory(blobsRoot, 'blobs')
          }
          void archive.finalize()
        })
      } finally {
        await rm(snapshot, { force: true })
      }
    },

    runIntegrityCheck() {
      const rows = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>
      const messages = rows.map((row) => row.integrity_check).filter((m) => m !== 'ok')
      return messages.length === 0 ? 'ok' : messages.join('; ')
    },
  }
}

/** Whether enough time has passed since `lastAt` (an ISO timestamp, or `null` if never run)
 *  to run the daily backup again. Pure, so the once-per-launch check is testable without a
 *  fake clock wired through the whole service. */
export function shouldRunDailyBackup(lastAt: string | null, now: Date): boolean {
  if (lastAt === null) return true
  const last = Date.parse(lastAt)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= ONE_DAY_MS
}

/** Same idea, weekly, for `PRAGMA integrity_check` (task 3.5). */
export function shouldRunWeeklyIntegrityCheck(lastAt: string | null, now: Date): boolean {
  if (lastAt === null) return true
  const last = Date.parse(lastAt)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= ONE_WEEK_MS
}

/**
 * Copy `backupFile` over `dbPath`, dropping the current `-wal`/`-shm` siblings so the
 * restored file is not merged with WAL frames that belong to the file it is replacing.
 * Callers must close the database connection first and relaunch the app after — this only
 * does the file swap.
 */
export async function swapInBackup(backupFile: string, dbPath: string): Promise<void> {
  await copyFile(backupFile, dbPath)
  for (const suffix of ['-wal', '-shm']) {
    await unlink(`${dbPath}${suffix}`).catch((error: unknown) => {
      if (!isNotFound(error)) log.error('[backups] restore: failed to clear', suffix, error)
    })
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
