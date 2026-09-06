/**
 * The host environment values a spawned sidecar is given, and nothing else.
 *
 * Its own module, with no imports at all, for one specific reason: the Electron **main**
 * process calls `forwardableEnv` when it builds the job pool's handshake, and everything else
 * in `../sidecars/` reaches for `node:child_process`. Importing the barrel there would drag a
 * process spawner into main's startup bundle to read six strings.
 */

/**
 * `SystemRoot`/`windir` are not optional on Windows — a process without them fails to
 * initialise Winsock and dies before it parses its arguments. `TMP`/`TEMP`/`TMPDIR` are where
 * ffmpeg writes scratch. `NUMBER_OF_PROCESSORS` is how whisper picks a default thread count.
 *
 * `PATH` is deliberately **absent**. The child's search path is built from the executable's
 * own directory instead (`sidecarEnv`), so a downloaded binary loads the libraries it shipped
 * with or none at all, rather than whatever CUDA runtime happens to be installed elsewhere.
 */
export const FORWARDED_ENV_KEYS = [
  'SystemRoot',
  'windir',
  'TMP',
  'TEMP',
  'TMPDIR',
  'NUMBER_OF_PROCESSORS',
] as const

/** Picks the forwardable subset out of an environment, dropping empty values. */
export function forwardableEnv(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of FORWARDED_ENV_KEYS) {
    const value = source[key]
    if (value !== undefined && value !== '') out[key] = value
  }
  return out
}
