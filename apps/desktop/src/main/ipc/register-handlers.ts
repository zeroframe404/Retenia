import type {
  ContractShape,
  InferInput,
  InferOutput,
  IpcErrorCode,
  IpcResult,
} from '@retenia/ipc-contract'
import { ipcFail, ipcOk } from '@retenia/ipc-contract'
import { type IpcMain, type IpcMainInvokeEvent, ipcMain } from 'electron'
import type { z } from 'zod'

/**
 * A handler deals in plain domain values: it receives validated input and returns the
 * output. The envelope, validation and error trapping all belong to `registerHandlers`.
 */
export type Handler<C extends ContractShape, K extends keyof C> = (
  input: InferInput<C, K>,
  event: IpcMainInvokeEvent,
) => InferOutput<C, K> | Promise<InferOutput<C, K>>

/** Exactly one handler per declared channel — a missing or extra key is a type error. */
export type Handlers<C extends ContractShape> = {
  [K in keyof C]: Handler<C, K>
}

/** The slice of `ipcMain` used here, so tests can pass a double instead of running Electron. */
export type IpcRegistrar = Pick<IpcMain, 'handle'>

export interface RegisterHandlersOptions {
  /** Decides whether the frame that sent a message is the application renderer. */
  isAllowedSender: (event: IpcMainInvokeEvent) => boolean
  ipc?: IpcRegistrar
  logger?: Pick<Console, 'error'>
}

/**
 * Wire every contract channel to its handler.
 *
 * Each call is checked in order — sender origin, input schema, handler, output schema —
 * and any failure becomes a `{ ok: false, error: { code, message } }` value. Handlers never
 * reject: an IPC rejection arrives in the renderer as an untyped `Error` with the code
 * lost, so the renderer could not tell "you sent nonsense" from "main crashed".
 */
export function registerHandlers<C extends ContractShape>(
  contract: C,
  handlers: Handlers<C>,
  { isAllowedSender, ipc = ipcMain, logger = console }: RegisterHandlersOptions,
): void {
  // Belt and braces for callers TypeScript does not check (plain JS, or a handler map
  // built dynamically): a handler with no channel would otherwise be silently dead code.
  for (const name of Object.keys(handlers)) {
    if (!Object.hasOwn(contract, name)) {
      throw new Error(`Cannot register a handler for "${name}": it is not in the IPC contract`)
    }
  }

  for (const channel of Object.keys(contract) as (keyof C & string)[]) {
    const definition = contract[channel]
    const handler = handlers[channel]

    if (!definition || typeof handler !== 'function') {
      throw new Error(`Missing handler for IPC channel "${channel}"`)
    }

    ipc.handle(channel, async (event, rawInput) => {
      const fail = (code: IpcErrorCode, message: string): IpcResult<never> => {
        logger.error(`[ipc] ${channel} failed (${code}): ${message}`)
        return ipcFail(code, message)
      }

      if (!isAllowedSender(event)) {
        return fail('FORBIDDEN_SENDER', 'The sending frame is not the application renderer')
      }

      const input = definition.input.safeParse(rawInput)
      if (!input.success) {
        return fail('INVALID_INPUT', summarizeIssues(input.error))
      }

      let result: unknown
      try {
        result = await handler(input.data as InferInput<C, keyof C>, event)
      } catch (error) {
        // Only the message crosses the bridge; a stack would leak main-process paths into
        // a context that has no business seeing them.
        return fail('HANDLER_ERROR', error instanceof Error ? error.message : String(error))
      }

      const output = definition.output.safeParse(result)
      if (!output.success) {
        return fail('INVALID_OUTPUT', summarizeIssues(output.error))
      }

      return ipcOk(output.data)
    })
  }
}

/** A compact, non-leaking description of what failed validation. */
function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}
