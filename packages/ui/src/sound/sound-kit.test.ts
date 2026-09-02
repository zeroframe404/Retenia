import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundKit } from './sound-kit'

function createFakeContext(overrides: { state?: AudioContextState } = {}) {
  const started: unknown[] = []
  const source = {
    buffer: undefined as unknown,
    // Real `AudioNode.connect()` returns the destination node (so calls chain,
    // `source.connect(gain).connect(destination)`) — mimic that rather than `this`.
    connect: vi.fn((dest: unknown) => dest),
    start: vi.fn(() => started.push('started')),
  }
  const gain = { gain: { value: 0 }, connect: vi.fn((dest: unknown) => dest) }
  const context = {
    state: overrides.state ?? 'running',
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createBufferSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 0.2 } as AudioBuffer),
  }
  return { context, source, gain, started }
}

function asAudioContext(context: ReturnType<typeof createFakeContext>['context']): AudioContext {
  return context as unknown as AudioContext
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SoundKit', () => {
  it('preloads and caches a decoded buffer', async () => {
    const { context } = createFakeContext()
    const kit = new SoundKit({ audioContext: asAudioContext(context) })

    await kit.preload(['click'])

    expect(context.decodeAudioData).toHaveBeenCalledTimes(1)

    await kit.play('click')
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1) // still cached, no re-fetch
  })

  it('plays a sound through a gain node at the given volume', async () => {
    const { context, source, gain } = createFakeContext()
    const kit = new SoundKit({ audioContext: asAudioContext(context) })

    await kit.play('correct', { volume: 0.5 })

    expect(gain.gain.value).toBe(0.5)
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(context.destination)
    expect(source.start).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when muted', async () => {
    const { context, source } = createFakeContext()
    const kit = new SoundKit({ audioContext: asAudioContext(context) })

    await kit.play('wrong', { muted: true })

    expect(source.start).not.toHaveBeenCalled()
    expect(context.decodeAudioData).not.toHaveBeenCalled()
  })

  it('is a no-op at zero volume', async () => {
    const { context, source } = createFakeContext()
    const kit = new SoundKit({ audioContext: asAudioContext(context) })

    await kit.play('wrong', { volume: 0 })

    expect(source.start).not.toHaveBeenCalled()
  })

  it('clamps volume above 1', async () => {
    const { context, gain } = createFakeContext()
    const kit = new SoundKit({ audioContext: asAudioContext(context) })

    await kit.play('streak', { volume: 4 })

    expect(gain.gain.value).toBe(1)
  })

  it('resumes a suspended context before playing', async () => {
    const { context, source } = createFakeContext({ state: 'suspended' })
    const kit = new SoundKit({ audioContext: asAudioContext(context) })

    await kit.play('levelUp')

    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(source.start).toHaveBeenCalledTimes(1)
  })

  it('never throws when decoding fails', async () => {
    const { context, source } = createFakeContext()
    context.decodeAudioData = vi.fn().mockRejectedValue(new Error('bad data'))
    const kit = new SoundKit({ audioContext: asAudioContext(context) })

    await expect(kit.play('correct')).resolves.toBeUndefined()
    expect(source.start).not.toHaveBeenCalled()
  })

  it('never throws when no AudioContext is available', async () => {
    const kit = new SoundKit({ audioContext: undefined })
    // Force context creation to fail the way it would in an environment with no
    // AudioContext constructor at all (SSR, jsdom).
    vi.stubGlobal('AudioContext', undefined)

    await expect(kit.play('correct')).resolves.toBeUndefined()
  })
})
