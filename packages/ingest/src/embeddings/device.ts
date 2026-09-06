/**
 * Which execution provider ONNX Runtime is asked for, and what to fall back to
 * (`docs/spec/05-ingestion-rag.md` §3: "WebGPU/WASM in the renderer, CPU/CUDA in Node").
 */

/** `auto` resolves to the ordered list below; the rest are asked for exactly. */
export type EmbeddingDevice = 'auto' | 'webgpu' | 'cuda' | 'dml' | 'cpu'

export const EMBEDDING_DEVICES: readonly EmbeddingDevice[] = [
  'auto',
  'webgpu',
  'cuda',
  'dml',
  'cpu',
]

export function isEmbeddingDevice(value: unknown): value is EmbeddingDevice {
  return typeof value === 'string' && (EMBEDDING_DEVICES as readonly string[]).includes(value)
}

/** What `resolveDevices` needs to know about where it is running. Injected in tests. */
export interface DeviceEnvironment {
  /** `process.platform`. */
  platform: string
  /** True when a WebGPU adapter is reachable — a renderer, never a `utilityProcess`. */
  hasWebGpu: boolean
  /** True when onnxruntime-node's CUDA execution-provider binaries are installed. They are
   *  not bundled in the npm tarball (see the `allowBuilds` note in `pnpm-workspace.yaml`),
   *  so this is an opt-in the user turns on, not something that is simply there. */
  hasCudaProvider: boolean
}

/**
 * The devices to try, in order, for a requested setting.
 *
 * Trying is the honest way to do this: ONNX Runtime only reports whether an execution
 * provider works by being asked to build a session with it, and a machine with the CUDA
 * binaries present but no usable driver fails exactly there. So an explicit request is
 * tried and then falls back to CPU, and `auto` skips the candidates this environment
 * already knows cannot work rather than paying a failed session build per start.
 *
 * CPU is always last and always present: it is the one that cannot fail, and
 * `docs/spec/05-ingestion-rag.md` §3 budgets for it (10–20 min for a 300-page book against
 * 1–3 on a GPU).
 */
export function resolveDevices(
  requested: EmbeddingDevice,
  environment: DeviceEnvironment,
): readonly Exclude<EmbeddingDevice, 'auto'>[] {
  const candidates: Exclude<EmbeddingDevice, 'auto'>[] = []
  const add = (device: Exclude<EmbeddingDevice, 'auto'>): void => {
    if (!candidates.includes(device)) candidates.push(device)
  }

  if (requested !== 'auto') add(requested)
  else {
    if (environment.hasWebGpu) add('webgpu')
    if (environment.hasCudaProvider) add('cuda')
    // DirectML is Windows-only and ships with onnxruntime-node's win32 prebuilds, so unlike
    // CUDA there is nothing to install — it is only ever unavailable because the machine is
    // not Windows.
    if (environment.platform === 'win32') add('dml')
  }
  add('cpu')
  return candidates
}

/** What the app runs in: `process.platform`, no WebGPU, CUDA only if the user installed it. */
export function nodeDeviceEnvironment(hasCudaProvider = false): DeviceEnvironment {
  return {
    platform: process.platform,
    // `utilityProcess` is Node, not Chromium: there is no `navigator.gpu` here, and asking
    // transformers.js for `webgpu` would only cost a failed session build per start.
    hasWebGpu: false,
    hasCudaProvider,
  }
}
