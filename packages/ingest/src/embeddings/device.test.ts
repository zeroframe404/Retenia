import { describe, expect, it } from 'vitest'
import { type DeviceEnvironment, isEmbeddingDevice, resolveDevices } from './device'

const environment = (overrides: Partial<DeviceEnvironment> = {}): DeviceEnvironment => ({
  platform: 'linux',
  hasWebGpu: false,
  hasCudaProvider: false,
  ...overrides,
})

describe('resolveDevices', () => {
  it('always ends at CPU, which is the one that cannot fail', () => {
    for (const requested of ['auto', 'webgpu', 'cuda', 'dml', 'cpu'] as const) {
      expect(resolveDevices(requested, environment()).at(-1)).toBe('cpu')
    }
  })

  it('falls back to CPU after an explicit request, rather than refusing to start', () => {
    // A user who ticked "CUDA" on a machine whose driver has since broken gets a slower app,
    // not an app that cannot embed at all.
    expect(resolveDevices('cuda', environment())).toEqual(['cuda', 'cpu'])
  })

  it('never lists a device twice', () => {
    expect(resolveDevices('cpu', environment())).toEqual(['cpu'])
  })

  it('on auto, skips accelerators this environment already knows are absent', () => {
    // A `utilityProcess` has no WebGPU and, without the opt-in CUDA binaries, no CUDA:
    // asking for either would only cost a failed session build on every start.
    expect(resolveDevices('auto', environment())).toEqual(['cpu'])
  })

  it('on auto, prefers WebGPU, then CUDA, then DirectML', () => {
    expect(
      resolveDevices(
        'auto',
        environment({ platform: 'win32', hasWebGpu: true, hasCudaProvider: true }),
      ),
    ).toEqual(['webgpu', 'cuda', 'dml', 'cpu'])
  })

  it('only offers DirectML on Windows, where onnxruntime-node ships it', () => {
    expect(resolveDevices('auto', environment({ platform: 'win32' }))).toEqual(['dml', 'cpu'])
    expect(resolveDevices('auto', environment({ platform: 'darwin' }))).toEqual(['cpu'])
  })
})

describe('isEmbeddingDevice', () => {
  it('narrows a stored setting, and rejects anything else', () => {
    expect(isEmbeddingDevice('cuda')).toBe(true)
    expect(isEmbeddingDevice('tpu')).toBe(false)
    expect(isEmbeddingDevice(null)).toBe(false)
  })
})
