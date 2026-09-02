import type {
  ChannelName,
  Contract,
  InferInput,
  InferOutput,
  IpcErrorCode,
} from '@retenia/ipc-contract'
import { contract } from '@retenia/ipc-contract'

/** A failed IPC call, carrying the contract's error code so callers can branch on it. */
export class IpcError extends Error {
  readonly code: IpcErrorCode

  constructor(channel: string, code: IpcErrorCode, message: string) {
    super(`${channel} failed (${code}): ${message}`)
    this.name = 'IpcError'
    this.code = code
  }
}

type ApiFunction = (input?: unknown) => Promise<unknown>

/**
 * Call a channel and unwrap its envelope.
 *
 * `window.api` returns `{ ok: false }` rather than rejecting, so that main can send a
 * typed code across the bridge. Everything above this line prefers exceptions — that is
 * how TanStack Query, error boundaries and `try`/`catch` all expect failure to arrive — so
 * this is where the envelope turns back into a throw.
 */
export async function invokeIpc<K extends ChannelName>(
  channel: K,
  input: InferInput<Contract, K>,
): Promise<InferOutput<Contract, K>> {
  const [domain, action] = channel.split('.') as [string, string]
  const namespace = (window.api as unknown as Record<string, Record<string, ApiFunction>>)[domain]
  const fn = namespace?.[action]

  if (typeof fn !== 'function') {
    throw new IpcError(channel, 'UNKNOWN_CHANNEL', 'not exposed on window.api')
  }

  const result = (await fn(input)) as
    | { ok: true; data: InferOutput<Contract, K> }
    | { ok: false; error: { code: IpcErrorCode; message: string } }

  if (!result.ok) {
    throw new IpcError(channel, result.error.code, result.error.message)
  }

  // Main validates its own output before sending it (`register-handlers.ts`), but nothing
  // re-checks it after crossing the bridge — this is that check on the renderer side,
  // completing "every channel validates on both sides" for the response direction the way
  // `buildApi` now does for the request direction.
  const parsed = contract[channel].output.safeParse(result.data)
  if (!parsed.success) {
    throw new IpcError(channel, 'INVALID_OUTPUT', parsed.error.message)
  }

  return parsed.data as InferOutput<Contract, K>
}
