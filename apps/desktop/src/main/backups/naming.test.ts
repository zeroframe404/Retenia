import { describe, expect, it } from 'vitest'
import { backupFileName, isBackupFileName, selectBackupsToPrune } from './naming'

describe('backupFileName', () => {
  it('formats as retenia-YYYYMMDD-HHmm.db, zero-padded', () => {
    expect(backupFileName(new Date(2026, 0, 5, 9, 3))).toBe('retenia-20260105-0903.db')
  })

  it('sorts lexicographically the same as chronologically', () => {
    const earlier = backupFileName(new Date(2026, 0, 1, 0, 0))
    const later = backupFileName(new Date(2026, 0, 1, 0, 1))
    expect([later, earlier].sort()).toEqual([earlier, later])
  })
})

describe('isBackupFileName', () => {
  it('accepts our own naming and rejects anything else', () => {
    expect(isBackupFileName('retenia-20260105-0903.db')).toBe(true)
    expect(isBackupFileName('retenia.db')).toBe(false)
    expect(isBackupFileName('retenia-20260105-0903.db-wal')).toBe(false)
    expect(isBackupFileName('something-else.db')).toBe(false)
  })
})

describe('selectBackupsToPrune', () => {
  it('keeps the newest N, prunes the rest', () => {
    const names = [
      'retenia-20260101-0000.db',
      'retenia-20260102-0000.db',
      'retenia-20260103-0000.db',
      'retenia-20260104-0000.db',
    ]
    expect(selectBackupsToPrune(names, 2)).toEqual([
      'retenia-20260101-0000.db',
      'retenia-20260102-0000.db',
    ])
  })

  it('prunes nothing when at or under the limit', () => {
    const names = ['retenia-20260101-0000.db', 'retenia-20260102-0000.db']
    expect(selectBackupsToPrune(names, 7)).toEqual([])
    expect(selectBackupsToPrune(names, 2)).toEqual([])
  })

  it('ignores files that are not ours', () => {
    const names = ['retenia-20260101-0000.db', 'notes.txt', 'retenia.db-wal']
    expect(selectBackupsToPrune(names, 0)).toEqual(['retenia-20260101-0000.db'])
  })

  it('does not care about the order it is given in', () => {
    const names = [
      'retenia-20260103-0000.db',
      'retenia-20260101-0000.db',
      'retenia-20260102-0000.db',
    ]
    expect(selectBackupsToPrune(names, 1)).toEqual([
      'retenia-20260101-0000.db',
      'retenia-20260102-0000.db',
    ])
  })
})
