import { createWriteStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ZipArchive } from 'archiver'
import { app } from 'electron'

export interface SystemInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  systemVersion: string
  gpu: unknown
}

/** Everything `exportDiagnostics` bundles alongside the log files, gathered here so the
 * zipping logic below stays independent of Electron's `app`/`process` globals. */
export async function collectSystemInfo(): Promise<SystemInfo> {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node ?? 'unknown',
    platform: process.platform,
    systemVersion: process.getSystemVersion(),
    gpu: await app.getGPUInfo('basic'),
  }
}

/**
 * Zip every file in `logsDir` plus a `system-info.json` (see `collectSystemInfo`) into
 * `destinationZipPath`. Used by the `app.exportDiagnostics` IPC handler after the renderer
 * has already picked a save location via `dialog.showSaveDialog`.
 */
export function exportDiagnostics(
  logsDir: string,
  systemInfo: SystemInfo,
  destinationZipPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destinationZipPath)
    const archive = new ZipArchive({ zlib: { level: 9 } })

    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)

    if (existsSync(logsDir)) {
      for (const name of readdirSync(logsDir)) {
        archive.file(join(logsDir, name), { name: `logs/${name}` })
      }
    }

    archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' })

    void archive.finalize()
  })
}
