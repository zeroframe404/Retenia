import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import unzipper from 'unzipper'
import { describe, expect, it, vi } from 'vitest'
import type { SystemInfo } from './export'

// `collectSystemInfo` (untested here) needs `app`; the rest of this file only needs the
// module to import cleanly.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', getGPUInfo: async () => ({}) } }))

const { exportDiagnostics } = await import('./export')

const systemInfo: SystemInfo = {
  appVersion: '0.1.0',
  electron: '44.1.1',
  chrome: '152.0',
  node: '24.19.0',
  platform: 'win32',
  systemVersion: '10.0.22631',
  gpu: { auxAttributes: {} },
}

describe('exportDiagnostics', () => {
  it('zips every log file plus system-info.json', async () => {
    const logsDir = mkdtempSync(join(tmpdir(), 'retenia-logs-'))
    writeFileSync(join(logsDir, 'main.log'), 'hello from main')
    writeFileSync(join(logsDir, 'main.old.log'), 'rotated')

    const zipPath = join(mkdtempSync(join(tmpdir(), 'retenia-diag-')), 'diagnostics.zip')
    await exportDiagnostics(logsDir, systemInfo, zipPath)

    const directory = await unzipper.Open.file(zipPath)
    const names = directory.files.map((f) => f.path).sort()
    expect(names).toEqual(['logs/main.log', 'logs/main.old.log', 'system-info.json'])

    const infoEntry = directory.files.find((f) => f.path === 'system-info.json')
    const infoBuffer = await infoEntry?.buffer()
    expect(JSON.parse(infoBuffer?.toString('utf-8') ?? '{}')).toEqual(systemInfo)
  })

  it('still writes system-info.json when the logs directory does not exist', async () => {
    const zipPath = join(mkdtempSync(join(tmpdir(), 'retenia-diag-')), 'diagnostics.zip')
    await exportDiagnostics(join(tmpdir(), 'retenia-logs-does-not-exist'), systemInfo, zipPath)

    const directory = await unzipper.Open.file(zipPath)
    expect(directory.files.map((f) => f.path)).toEqual(['system-info.json'])
  })
})
