import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePersistedSplitSize } from './use-persisted-split-size'

describe('usePersistedSplitSize', () => {
  afterEach(() => window.localStorage.clear())

  it('starts at the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedSplitSize('test.split', 65))
    expect(result.current[0]).toBe(65)
  })

  it('reads a previously stored value', () => {
    window.localStorage.setItem('test.split', '42')
    const { result } = renderHook(() => usePersistedSplitSize('test.split', 65))
    expect(result.current[0]).toBe(42)
  })

  it('persists a new value and updates state', () => {
    const { result } = renderHook(() => usePersistedSplitSize('test.split', 65))
    act(() => result.current[1](30))
    expect(result.current[0]).toBe(30)
    expect(window.localStorage.getItem('test.split')).toBe('30')
  })

  it('survives a remount with the persisted value (the "restart" case)', () => {
    const { result, unmount } = renderHook(() => usePersistedSplitSize('test.split', 65))
    act(() => result.current[1](77))
    unmount()

    const remounted = renderHook(() => usePersistedSplitSize('test.split', 65))
    expect(remounted.result.current[0]).toBe(77)
  })

  it('falls back gracefully when localStorage throws', () => {
    const getItem = vi
      .spyOn(Object.getPrototypeOf(window.localStorage), 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    const { result } = renderHook(() => usePersistedSplitSize('test.split', 65))
    expect(result.current[0]).toBe(65)
    getItem.mockRestore()
  })
})
