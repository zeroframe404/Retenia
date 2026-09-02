import { appPing } from './channels/example'

/** Every declared IPC channel, keyed by its channel name. Main and preload both import this. */
export const channelMap = {
  [appPing.channel]: appPing,
} as const

export type ChannelName = keyof typeof channelMap
