import type { ContractApi } from './api-types'
import { appChannels } from './channels/app'
import { appEvents } from './events/app'

export type {
  ActionOf,
  AssertNoEventsDomain,
  ContractApi,
  DomainOf,
} from './api-types'
export type { Settings, ThemePreference, UpdateChannel } from './channels/app'
export { settingsSchema, themePreferenceSchema, updateChannelSchema } from './channels/app'
export type {
  ChannelDefinition,
  ContractShape,
  EventShape,
  InferEvent,
  InferInput,
  InferOutput,
} from './define'
export { defineContract, defineEvents } from './define'
export type { IpcError, IpcErrorCode, IpcResult } from './envelope'
export { ipcErrorCodes, ipcErrorSchema, ipcFail, ipcOk } from './envelope'
export type { DeepLink, UpdateStatus } from './events/app'
export { updateStatusSchema } from './events/app'

/**
 * Every main<->renderer request/response channel. Merge one object per domain; the
 * `domain.action` keys are what main registers, preload generates and the renderer calls.
 */
export const contract = {
  ...appChannels,
}

/** Every push channel main can send to the renderer (`webContents.send`). */
export const events = {
  ...appEvents,
}

export type Contract = typeof contract
export type Events = typeof events
export type ChannelName = keyof Contract & string
export type EventName = keyof Events & string

/** The `window.api` shape both preload and the renderer are typed against. */
export type RendererApi = ContractApi<Contract, Events>

export const channelNames: readonly ChannelName[] = Object.freeze(
  Object.keys(contract) as ChannelName[],
)

export const eventNames: readonly EventName[] = Object.freeze(Object.keys(events) as EventName[])

/** Narrow an untrusted string to a declared channel. `Object.hasOwn` so a prototype key never passes. */
export function isChannelName(value: unknown): value is ChannelName {
  return typeof value === 'string' && Object.hasOwn(contract, value)
}

/** Narrow an untrusted string to a declared push event. */
export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && Object.hasOwn(events, value)
}
