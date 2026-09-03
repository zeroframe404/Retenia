import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate } from './migrator'
import { DATABASE_PRAGMAS, IN_MEMORY, type OpenedDatabase, openDatabase } from './open-database'
import { settings } from './schema'
import { audit } from './testing'

const cipherDriverAvailable = (() => {
  try {
    createRequire(import.meta.url).resolve('better-sqlite3-multiple-ciphers')
    return true
  } catch {
    return false
  }
})()

describe('openDatabase()', () => {
  const opened: OpenedDatabase[] = []
  const dirs: string[] = []
  afterEach(() => {
    for (const db of opened.splice(0)) db.close()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempFile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'retenia-db-'))
    dirs.push(dir)
    return join(dir, 'retenia.db')
  }

  function track(db: OpenedDatabase): OpenedDatabase {
    opened.push(db)
    return db
  }

  it('applies the operation pragmas of the architecture spec to a file database', () => {
    const db = track(openDatabase(tempFile()))
    const pragma = (name: string) => db.sqlite.pragma(name, { simple: true })

    expect(pragma('journal_mode')).toBe('wal')
    expect(pragma('synchronous')).toBe(1) // NORMAL
    expect(pragma('foreign_keys')).toBe(1)
    expect(pragma('busy_timeout')).toBe(DATABASE_PRAGMAS.busy_timeout)
    expect(pragma('cache_size')).toBe(DATABASE_PRAGMAS.cache_size)
    expect(pragma('temp_store')).toBe(2) // MEMORY
    expect(db.driver).toBe('better-sqlite3')
    expect(db.path).toMatch(/retenia\.db$/)
  })

  it('opens an in-memory database (journal_mode reports "memory" there) and loads sqlite-vec', () => {
    const db = track(openDatabase(IN_MEMORY))
    expect(db.sqlite.pragma('journal_mode', { simple: true })).toBe('memory')
    expect(db.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.vecLoaded).toBe(true)
    expect(db.sqlite.prepare<[], { v: string }>('SELECT vec_version() AS v').get()?.v).toMatch(/^v/)
  })

  it('returns a Drizzle instance bound to the same connection', () => {
    const db = track(openDatabase(IN_MEMORY))
    migrate(db)
    db.db
      .insert(settings)
      .values({ id: '01a05a43-fc00-7000-8000-000000000001', key: 'k', value: 1, ...audit(1) })
      .run()
    expect(db.sqlite.prepare("SELECT value FROM settings WHERE key = 'k'").get()).toEqual({
      value: '1',
    })
    expect(db.db.$client).toBe(db.sqlite)
  })

  it('can skip loading sqlite-vec', () => {
    const db = track(openDatabase(IN_MEMORY, { loadVec: false }))
    expect(db.vecLoaded).toBe(false)
    expect(() => db.sqlite.prepare('SELECT vec_version()').get()).toThrow(/no such function/)
  })

  it('honours a custom busy timeout', () => {
    const db = track(openDatabase(IN_MEMORY, { busyTimeoutMs: 250 }))
    expect(db.sqlite.pragma('busy_timeout', { simple: true })).toBe(250)
  })

  it('opens read-only without forcing WAL and rejects writes', () => {
    const path = tempFile()
    const writer = openDatabase(path)
    migrate(writer)
    writer.close()

    const reader = track(openDatabase(path, { readonly: true }))
    expect(reader.sqlite.readonly).toBe(true)
    expect(() => reader.sqlite.exec("INSERT INTO settings (id) VALUES ('x')")).toThrow(/readonly/i)
    expect(reader.sqlite.prepare('SELECT count(*) AS n FROM importance_levels').get()).toEqual({
      n: 5,
    })
  })

  it('close() is idempotent', () => {
    const db = openDatabase(IN_MEMORY)
    db.close()
    expect(db.sqlite.open).toBe(false)
    expect(() => db.close()).not.toThrow()
  })

  it('refuses an encryption key on the plain driver instead of silently ignoring it', () => {
    expect(() =>
      openDatabase(IN_MEMORY, { encryptionKey: 'secret', driver: 'better-sqlite3' }),
    ).toThrow(/would ignore it/)
    expect(() => openDatabase(IN_MEMORY, { encryptionKey: '' })).toThrow(/must not be empty/)
    expect(() => openDatabase(IN_MEMORY, { encryptionKey: 'secret' })).toThrow(/in-memory/)
  })

  describe.skipIf(!cipherDriverAvailable)(
    'with better-sqlite3-multiple-ciphers (feature flag)',
    () => {
      it('selects the cipher driver whenever a key is given', () => {
        const db = track(openDatabase(tempFile(), { encryptionKey: 'secret' }))
        expect(db.driver).toBe('better-sqlite3-multiple-ciphers')
        expect(db.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
        expect(db.vecLoaded).toBe(true)
        migrate(db)
      })

      it('encrypts the file at rest: the right key reads it, a wrong key or no key cannot', () => {
        const path = tempFile()
        const encrypted = openDatabase(path, { encryptionKey: 'correct horse battery staple' })
        migrate(encrypted)
        encrypted.db
          .insert(settings)
          .values({
            id: '01a05a43-fc00-7000-8000-000000000002',
            key: 'theme',
            value: 'dark',
            ...audit(1),
          })
          .run()
        encrypted.close()

        expect(() => openDatabase(path, { encryptionKey: 'wrong' })).toThrow(/not a database/i)
        expect(() => openDatabase(path, { driver: 'better-sqlite3-multiple-ciphers' })).toThrow(
          /not a database/i,
        )
        expect(() => openDatabase(path)).toThrow(/not a database/i)

        const reopened = track(
          openDatabase(path, { encryptionKey: 'correct horse battery staple' }),
        )
        expect(
          reopened.sqlite.prepare("SELECT value FROM settings WHERE key = 'theme'").get(),
        ).toEqual({ value: '"dark"' })
        expect(reopened.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
      })

      it('can run the plain (unencrypted) path through the cipher driver too', () => {
        const db = track(openDatabase(IN_MEMORY, { driver: 'better-sqlite3-multiple-ciphers' }))
        expect(db.driver).toBe('better-sqlite3-multiple-ciphers')
        expect(migrate(db).applied).toHaveLength(3)
      })
    },
  )
})
