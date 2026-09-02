import type { IpcMainInvokeEvent, WebFrameMain } from 'electron'
import { describe, expect, it } from 'vitest'
import { APP_ORIGIN } from '../security/origins'
import { makeSenderGuard } from './sender'

const isAllowedSender = makeSenderGuard([APP_ORIGIN])

function frame(overrides: Partial<WebFrameMain> = {}): IpcMainInvokeEvent {
  const senderFrame = {
    origin: APP_ORIGIN,
    parent: null,
    isDestroyed: () => false,
    ...overrides,
  }
  return { senderFrame } as unknown as IpcMainInvokeEvent
}

describe('makeSenderGuard', () => {
  it('accepts the top-level application renderer', () => {
    expect(isAllowedSender(frame())).toBe(true)
  })

  it.each([
    ['a remote page', 'https://evil.test'],
    ['another app host', 'app://evil'],
    ['a host that merely starts the same', 'app://retenia.evil.test'],
    ['an opaque origin, e.g. a sandboxed iframe or a data: url', 'null'],
    ['no origin at all', ''],
  ])('rejects %s', (_label, origin) => {
    expect(isAllowedSender(frame({ origin }))).toBe(false)
  })

  it('rejects a subframe even when its origin matches', () => {
    // nodeIntegrationInSubFrames is off and no iframe in the app calls a channel, so an
    // invoke from one means injected content inside the app's own origin.
    expect(isAllowedSender(frame({ parent: {} as WebFrameMain }))).toBe(false)
  })

  it('rejects a frame that has already been destroyed', () => {
    expect(isAllowedSender(frame({ isDestroyed: () => true }))).toBe(false)
  })

  it('rejects a frame that is gone', () => {
    expect(isAllowedSender({ senderFrame: null } as unknown as IpcMainInvokeEvent)).toBe(false)
  })

  it('rejects when reading the frame throws', () => {
    const event = {
      get senderFrame(): WebFrameMain {
        throw new Error('frame was disposed')
      },
    } as unknown as IpcMainInvokeEvent
    expect(isAllowedSender(event)).toBe(false)
  })
})
