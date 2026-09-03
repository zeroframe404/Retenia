const BACKUP_PREFIX = 'retenia-'
const BACKUP_SUFFIX = '.db'
/** `retenia-YYYYMMDD-HHmm.db`; the timestamp format sorts lexicographically the same as
 *  chronologically, so `Array.sort()` alone gives rotation its ordering. */
const BACKUP_NAME = /^retenia-(\d{8}-\d{4})\.db$/

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** `retenia-YYYYMMDD-HHmm.db` for `now`, in local time (what a user restoring their own
 *  machine expects to read). */
export function backupFileName(now: Date): string {
  const y = now.getFullYear()
  const mo = pad(now.getMonth() + 1, 2)
  const d = pad(now.getDate(), 2)
  const h = pad(now.getHours(), 2)
  const mi = pad(now.getMinutes(), 2)
  return `${BACKUP_PREFIX}${y}${mo}${d}-${h}${mi}${BACKUP_SUFFIX}`
}

/** Whether `fileName` is one of ours (as opposed to something else a user dropped into the
 *  backups folder). */
export function isBackupFileName(fileName: string): boolean {
  return BACKUP_NAME.test(fileName)
}

/** Given every backup file name currently on disk, which ones rotation should delete to
 *  keep only the newest `keep`. Pure so rotation logic is testable without touching the
 *  filesystem. */
export function selectBackupsToPrune(fileNames: readonly string[], keep: number): string[] {
  const ours = fileNames.filter(isBackupFileName).toSorted()
  if (ours.length <= keep) return []
  return ours.slice(0, ours.length - keep)
}
