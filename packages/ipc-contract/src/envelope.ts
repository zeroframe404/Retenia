import { z } from 'zod'

/**
 * Why a call failed. The renderer switches on these, so they are part of the contract:
 * add a code here rather than encoding a reason in the message string.
 */
export const ipcErrorCodes = [
  /** The payload the renderer sent did not match the channel's input schema. */
  'INVALID_INPUT',
  /** The handler's return value did not match the channel's output schema — a main-side bug. */
  'INVALID_OUTPUT',
  /** The frame that sent the message is not the application renderer. */
  'FORBIDDEN_SENDER',
  /** The channel is not declared in the contract. */
  'UNKNOWN_CHANNEL',
  /** The handler itself threw. */
  'HANDLER_ERROR',
] as const

export type IpcErrorCode = (typeof ipcErrorCodes)[number]

export const ipcErrorSchema = z.object({
  code: z.enum(ipcErrorCodes),
  message: z.string(),
})

export type IpcError = z.infer<typeof ipcErrorSchema>

/**
 * Every handler resolves with one of these. Failures are values, never rejections:
 * an Electron IPC rejection loses the error type on the way across the bridge, and the
 * renderer needs the code to decide what to do.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export function ipcOk<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function ipcFail<T = never>(code: IpcErrorCode, message: string): IpcResult<T> {
  return { ok: false, error: { code, message } }
}
