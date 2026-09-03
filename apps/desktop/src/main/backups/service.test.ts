import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { createBackupService, shouldRunDailyBackup, shouldRunWeeklyIntegrityCheck, swapInBackup } =
  await import('./service')

let dir: string
let dbPath: string
let backupsRoot: string
let blobsRoot: string
let sqlite: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'retenia-backups-'))
  dbPath = join(dir, 'retenia.db')
  backupsRoot = join(dir, 'backups')
  blobsRoot = join(dir, 'blobs')
  sqlite = new Database(dbPath)
  sqlite.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)')
  sqlite.prepare('INSERT INTO t (value) VALUES (?)').run('hello')
})

afterEach(() => {
  sqlite.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createBackupService', () => {
  it('backupNow writes a timestamped, restorable snapshot', async () => {
    const service = createBackupService({ sqlite, backupsRoot, blobsRoot })

    const file = await service.backupNow()

    expect(existsSync(file)).toBe(true)
    const snapshot = new Database(file, { readonly: true })
    expect(snapshot.prepare('SELECT value FROM t').get()).toEqual({ value: 'hello' })
    snapshot.close()
  })

  it('a backup file appears once backupNow runs — what the on-quit hook calls', async () => {
    const service = createBackupService({ sqlite, backupsRoot, blobsRoot })
    expect(existsSync(backupsRoot)).toBe(false)

    await service.backupNow()

    const files = readdirSync(backupsRoot)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^retenia-\d{8}-\d{4}\.db$/)
  })

  it('rotates down to the newest 7 after each backup', async () => {
    let now = new Date(2026, 0, 1, 0, 0)
    const service = createBackupService({
      sqlite,
      backupsRoot,
      blobsRoot,
      clock: { now: () => now },
    })

    for (let i = 0; i < 9; i++) {
      await service.backupNow()
      now = new Date(now.getTime() + 60_000)
    }

    const files = readdirSync(backupsRoot)
    expect(files).toHaveLength(7)
  })

  it('list reports every backup with its size', async () => {
    const service = createBackupService({ sqlite, backupsRoot, blobsRoot })
    await service.backupNow()

    const summaries = await service.list()

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.bytes).toBeGreaterThan(0)
  })

  it('exportCopy zips a fresh DB snapshot and the blobs directory', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(blobsRoot, { recursive: true })
    writeFileSync(join(blobsRoot, 'sample.bin'), 'blob bytes')
    const service = createBackupService({ sqlite, backupsRoot, blobsRoot })
    const destZip = join(dir, 'export.zip')

    await service.exportCopy(destZip)

    expect(existsSync(destZip)).toBe(true)
    const { statSync } = await import('node:fs')
    expect(statSync(destZip).size).toBeGreaterThan(0)
    // The intermediate snapshot used to build the zip is not left behind.
    expect(readdirSync(backupsRoot).filter((f) => f.startsWith('.export-'))).toEqual([])
  })

  it('runIntegrityCheck reports ok for a healthy database', () => {
    const service = createBackupService({ sqlite, backupsRoot, blobsRoot })
    expect(service.runIntegrityCheck()).toBe('ok')
  })
})

describe('shouldRunDailyBackup', () => {
  const now = new Date(2026, 0, 2, 12, 0)

  it('runs when it has never run', () => {
    expect(shouldRunDailyBackup(null, now)).toBe(true)
  })

  it('runs when the stored timestamp is unparsable', () => {
    expect(shouldRunDailyBackup('not a date', now)).toBe(true)
  })

  it('does not run again within 24h', () => {
    const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    expect(shouldRunDailyBackup(recent, now)).toBe(false)
  })

  it('runs again after 24h', () => {
    const yesterday = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString()
    expect(shouldRunDailyBackup(yesterday, now)).toBe(true)
  })
})

describe('shouldRunWeeklyIntegrityCheck', () => {
  const now = new Date(2026, 0, 8, 12, 0)

  it('runs when it has never run', () => {
    expect(shouldRunWeeklyIntegrityCheck(null, now)).toBe(true)
  })

  it('does not run again within 7 days', () => {
    const recent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(shouldRunWeeklyIntegrityCheck(recent, now)).toBe(false)
  })

  it('runs again after 7 days', () => {
    const lastWeek = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()
    expect(shouldRunWeeklyIntegrityCheck(lastWeek, now)).toBe(true)
  })
})

describe('swapInBackup', () => {
  it('copies the backup over the live db path and clears -wal/-shm siblings', async () => {
    const service = createBackupService({ sqlite, backupsRoot, blobsRoot })
    const backupFile = await service.backupNow()
    sqlite.close()

    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`
    writeFileSync(walPath, 'stale wal frames')
    writeFileSync(shmPath, 'stale shm')

    await swapInBackup(backupFile, dbPath)

    expect(existsSync(walPath)).toBe(false)
    expect(existsSync(shmPath)).toBe(false)
    const restored = new Database(dbPath, { readonly: true })
    expect(restored.prepare('SELECT value FROM t').get()).toEqual({ value: 'hello' })
    restored.close()
  })

  it('does not fail when there is nothing to clear', async () => {
    const service = createBackupService({ sqlite, backupsRoot, blobsRoot })
    const backupFile = await service.backupNow()
    sqlite.close()

    await expect(swapInBackup(backupFile, dbPath)).resolves.toBeUndefined()
  })
})
