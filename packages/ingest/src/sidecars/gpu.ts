import { type RunSidecarOptions, runSidecar } from './spawn'

/**
 * Whether this machine has an NVIDIA GPU worth downloading a 670 MB CUDA build for
 * (`docs/spec/07-architecture.md` §7: "pre-compiled whisper-cli (CPU + CUDA, detect the
 * NVIDIA GPU)").
 *
 * Detection is `nvidia-smi`, which ships with the driver, and it is deliberately the *only*
 * signal. Reading the PCI device list would find a card whose driver is missing or too old,
 * and the failure that produces — a CUDA build that downloads for ten minutes and then cannot
 * load its runtime — is much worse than transcribing on the CPU. If `nvidia-smi` answers, the
 * driver is installed and working.
 *
 * Never throws. Every failure — no such binary, a non-zero exit, a driver in a bad state — is
 * the same answer: no usable GPU, use the CPU build.
 */

export interface NvidiaGpu {
  name: string
  driverVersion: string
  /** Total VRAM in MiB, as `nvidia-smi` reports it. */
  memoryMiB: number | null
}

export type GpuDetection = { present: false } | { present: true; gpus: readonly NvidiaGpu[] }

/** The smallest card worth preferring over the CPU. `ggml-large-v3-turbo-q5_0` is 574 MB of
 *  weights, and a 2 GiB card spends more time swapping than it saves. */
export const MIN_USEFUL_VRAM_MIB = 4_096

export const NVIDIA_SMI_ARGS = [
  '--query-gpu=name,driver_version,memory.total',
  '--format=csv,noheader,nounits',
] as const

/** `NVIDIA GeForce RTX 4070 SUPER, 566.36, 12282` → one `NvidiaGpu`. */
export function parseNvidiaSmi(stdout: string): NvidiaGpu[] {
  const gpus: NvidiaGpu[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.length < 2) continue
    const [name, driverVersion, memory] = parts
    if (name === undefined || driverVersion === undefined || name.length === 0) continue
    const memoryMiB = memory === undefined ? Number.NaN : Number.parseInt(memory, 10)
    gpus.push({
      name,
      driverVersion,
      memoryMiB: Number.isFinite(memoryMiB) ? memoryMiB : null,
    })
  }
  return gpus
}

export type SidecarRunner = (options: RunSidecarOptions) => Promise<{ code: number | null }>

let cached: GpuDetection | undefined

/**
 * Runs `nvidia-smi` once per process and remembers the answer.
 *
 * Cached because a machine does not grow a GPU mid-session, and because this is consulted on
 * every media job: spawning a process per import to learn something that cannot change is
 * both wasteful and, on a laptop with a discrete card asleep, slow enough to notice.
 */
export async function detectNvidia(
  options: { run?: SidecarRunner; hostEnv?: Record<string, string>; force?: boolean } = {},
): Promise<GpuDetection> {
  if (cached !== undefined && options.force !== true) return cached

  let stdout = ''
  try {
    await (options.run ?? runSidecar)({
      exe: 'nvidia-smi',
      tool: 'nvidia-smi',
      args: NVIDIA_SMI_ARGS,
      timeoutMs: 5_000,
      hostEnv: options.hostEnv,
      onStdoutLine: (line) => {
        stdout += `${line}\n`
      },
    })
  } catch {
    cached = { present: false }
    return cached
  }

  const gpus = parseNvidiaSmi(stdout)
  cached = gpus.length === 0 ? { present: false } : { present: true, gpus }
  return cached
}

/** Test seam: clears the per-process memo. */
export function resetGpuDetection(): void {
  cached = undefined
}

/** Whether the CUDA whisper build is worth its download on this machine. */
export function prefersCuda(detection: GpuDetection): boolean {
  if (!detection.present) return false
  return detection.gpus.some(
    (gpu) => gpu.memoryMiB === null || gpu.memoryMiB >= MIN_USEFUL_VRAM_MIB,
  )
}
