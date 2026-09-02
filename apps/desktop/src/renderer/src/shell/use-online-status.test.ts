import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOnlineStatus } from './use-online-status'

function setOnLine(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useOnlineStatus', () => {
  it('reports the current connection state', () => {
    setOnLine(false)
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(false)

    setOnLine(true)
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(true)
  })

  it('re-renders when the connection drops and comes back', () => {
    setOnLine(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    setOnLine(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)

    setOnLine(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })

  it('unsubscribes on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    renderHook(() => useOnlineStatus()).unmount()
    const events = remove.mock.calls.map(([event]) => event)
    expect(events).toContain('online')
    expect(events).toContain('offline')
  })
})
