import { describe, expect, it } from 'vitest'
import { isPathInSyncedFolder } from './synced-folder'

describe('isPathInSyncedFolder', () => {
  it('flags a Windows OneDrive path', () => {
    expect(isPathInSyncedFolder('C:\\Users\\ana\\OneDrive\\AppData\\Roaming\\Retenia')).toBe(true)
  })

  it('flags Dropbox and Google Drive, case-insensitively', () => {
    expect(isPathInSyncedFolder('/home/ana/dropbox/Retenia')).toBe(true)
    expect(isPathInSyncedFolder('/Users/ana/Google Drive/Retenia')).toBe(true)
  })

  it('does not flag an ordinary path', () => {
    expect(isPathInSyncedFolder('C:\\Users\\ana\\AppData\\Roaming\\Retenia')).toBe(false)
  })

  it('does not flag a folder that merely contains the word as a substring', () => {
    expect(isPathInSyncedFolder('C:\\Users\\ana\\MyOneDriveClone\\Retenia')).toBe(false)
  })
})
