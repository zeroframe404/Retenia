import { beforeEach, describe, expect, it } from 'vitest'
import {
  detectNvidia,
  type GpuDetection,
  MIN_USEFUL_VRAM_MIB,
  NVIDIA_SMI_ARGS,
  type NvidiaGpu,
  parseNvidiaSmi,
  prefersCuda,
  resetGpuDetection,
  type SidecarRunner,
} from './gpu'

/**
 * The choice between the 670 MB CUDA whisper build and the CPU one
 * (`docs/spec/07-architecture.md` §7), tested against the text `nvidia-smi` really prints and
 * against the failure that is not a failure.
 *
 * On the overwhelming majority of machines this runs on, `nvidia-smi` does not exist. That
 * `ENOENT` is the *common* answer, not an error path: if it ever escaped, importing a video on
 * a laptop with integrated graphics would fail instead of transcribing on the CPU. So the
 * runner is injected and made to throw, and the assertion is on the answer rather than on a
 * rejection — a shape a test running on the developer's own RTX 4070 would never reach.
 *
 * The parser fixtures are verbatim `--format=csv,noheader,nounits` output, including the two
 * things that make a naive split wrong: the blank line a trailing newline leaves behind, and
 * the driver-error banner `nvidia-smi` writes to stdout when it cannot reach the driver, which
 * has no commas and must not become a GPU named after an apology.
 *
 * `resetGpuDetection` runs before every test because the memo is process-wide by design; left
 * alone, whichever test ran first would decide the answers of all the others.
 */

const RTX_4070 = 'NVIDIA GeForce RTX 4070 SUPER, 566.36, 12282'
const GT_1030 = 'NVIDIA GeForce GT 1030, 566.36, 2048'
const DRIVER_ERROR = "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver."

interface FakeRunner {
  run: SidecarRunner
  /** How many times `detectNvidia` actually reached for the process. */
  runs: number
}

function runnerPrinting(stdout: string): FakeRunner {
  const runner: FakeRunner = {
    runs: 0,
    run: (options) => {
      runner.runs += 1
      for (const line of stdout.split('\n')) options.onStdoutLine?.(line)
      return Promise.resolve({ code: 0 })
    },
  }
  return runner
}

/** What an absent `nvidia-smi` looks like from here: `runSidecar` rejects before any output. */
function runnerMissing(): FakeRunner {
  const runner: FakeRunner = {
    runs: 0,
    run: () => {
      runner.runs += 1
      return Promise.reject(new Error('could not start nvidia-smi: spawn ENOENT'))
    },
  }
  return runner
}

const gpu = (memoryMiB: number | null, name = 'NVIDIA GeForce RTX 4070 SUPER'): NvidiaGpu => ({
  name,
  driverVersion: '566.36',
  memoryMiB,
})

const detected = (...gpus: readonly NvidiaGpu[]): GpuDetection => ({ present: true, gpus })

beforeEach(() => {
  resetGpuDetection()
})

describe('parseNvidiaSmi', () => {
  it('reads the card off one line of CSV', () => {
    expect(parseNvidiaSmi(`${RTX_4070}\n`)).toEqual([
      { name: 'NVIDIA GeForce RTX 4070 SUPER', driverVersion: '566.36', memoryMiB: 12282 },
    ])
  })

  it('reads every card on a machine with two of them', () => {
    const gpus = parseNvidiaSmi(`${RTX_4070}\n${GT_1030}\n`)
    expect(gpus.map((entry) => entry.name)).toEqual([
      'NVIDIA GeForce RTX 4070 SUPER',
      'NVIDIA GeForce GT 1030',
    ])
    expect(gpus.map((entry) => entry.memoryMiB)).toEqual([12282, 2048])
  })

  it('ignores the blank lines a trailing newline and CRLF endings leave behind', () => {
    expect(parseNvidiaSmi(`\r\n${RTX_4070}\r\n\r\n`)).toHaveLength(1)
    expect(parseNvidiaSmi('\n\n')).toEqual([])
  })

  it('reports VRAM the driver did not give as null rather than NaN', () => {
    // `memoryMiB` reaches `prefersCuda` as a number, and a NaN there compares false against
    // every threshold — the CUDA build would be silently declined on a card that has plenty.
    expect(parseNvidiaSmi('NVIDIA GeForce GTX 1080, 470.256.02')[0]?.memoryMiB).toBeNull()
    expect(parseNvidiaSmi('NVIDIA A100-SXM4, 550.54.14, [N/A]')[0]?.memoryMiB).toBeNull()
  })

  it('does not read a driver-error banner as a GPU', () => {
    expect(parseNvidiaSmi(`${DRIVER_ERROR}\n`)).toEqual([])
  })
})

describe('detectNvidia', () => {
  it('asks nvidia-smi for exactly the CSV the parser expects', async () => {
    let asked: readonly string[] = []
    const run: SidecarRunner = (options) => {
      asked = options.args
      return Promise.resolve({ code: 0 })
    }
    await detectNvidia({ run })

    expect(asked).toEqual([...NVIDIA_SMI_ARGS])
  })

  it('reports the cards when nvidia-smi answers', async () => {
    const detection = await detectNvidia({ run: runnerPrinting(`${RTX_4070}\n`).run })

    expect(detection).toEqual(detected(gpu(12282)))
  })

  it('reports no GPU when nvidia-smi cannot be run at all', async () => {
    const runner = runnerMissing()
    await expect(detectNvidia({ run: runner.run })).resolves.toEqual({ present: false })
    expect(runner.runs).toBe(1)
  })

  it('reports no GPU when nvidia-smi runs but names none', async () => {
    // A driver in a bad state exits zero and says so in prose; there is still nothing to run
    // CUDA on.
    await expect(detectNvidia({ run: runnerPrinting(DRIVER_ERROR).run })).resolves.toEqual({
      present: false,
    })
  })

  it('runs nvidia-smi once per process and reuses the answer', async () => {
    // Consulted on every media job, and on a laptop whose discrete card is asleep the spawn is
    // slow enough to notice — for something that cannot change between two imports.
    await detectNvidia({ run: runnerMissing().run })
    const second = runnerPrinting(`${RTX_4070}\n`)
    expect(await detectNvidia({ run: second.run })).toEqual({ present: false })
    expect(second.runs).toBe(0)
  })

  it('looks again once the memo is reset, and when forced', async () => {
    await detectNvidia({ run: runnerMissing().run })

    resetGpuDetection()
    const afterReset = runnerPrinting(`${RTX_4070}\n`)
    expect(await detectNvidia({ run: afterReset.run })).toEqual(detected(gpu(12282)))
    expect(afterReset.runs).toBe(1)

    const forced = runnerPrinting(`${RTX_4070}\n${GT_1030}\n`)
    expect(await detectNvidia({ run: forced.run, force: true })).toEqual(
      detected(gpu(12282), gpu(2048, 'NVIDIA GeForce GT 1030')),
    )
  })
})

describe('prefersCuda', () => {
  it('declines the CUDA build on a machine with no NVIDIA card', () => {
    expect(prefersCuda({ present: false })).toBe(false)
  })

  it('declines a card too small to hold the weights without swapping', () => {
    expect(prefersCuda(detected(gpu(2048, 'NVIDIA GeForce GT 1030')))).toBe(false)
    expect(prefersCuda(detected(gpu(MIN_USEFUL_VRAM_MIB - 1)))).toBe(false)
  })

  it('accepts a card at exactly the useful minimum', () => {
    expect(prefersCuda(detected(gpu(MIN_USEFUL_VRAM_MIB)))).toBe(true)
    expect(prefersCuda(detected(gpu(12282)))).toBe(true)
  })

  it('accepts a card whose VRAM nvidia-smi did not report', () => {
    // Refusing on a missing column would decline CUDA on a machine that demonstrably has a
    // working driver; the download is the cheaper mistake of the two.
    expect(prefersCuda(detected(gpu(null)))).toBe(true)
  })

  it('accepts a machine where only one of two cards is big enough', () => {
    expect(prefersCuda(detected(gpu(2048, 'NVIDIA GeForce GT 1030'), gpu(12282)))).toBe(true)
  })
})
