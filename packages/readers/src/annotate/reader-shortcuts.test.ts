import { describe, expect, it, vi } from 'vitest'
import { createReaderShortcutHandler } from './reader-shortcuts'

function keyEvent(key: string, target: EventTarget) {
  return {
    key,
    target,
    preventDefault: vi.fn(),
  } as unknown as Parameters<ReturnType<typeof createReaderShortcutHandler>>[0]
}

describe('createReaderShortcutHandler', () => {
  it('maps n/p/h/c (case-insensitively) to their handlers', () => {
    const handlers = {
      onNextPage: vi.fn(),
      onPrevPage: vi.fn(),
      onHighlight: vi.fn(),
      onCreateCard: vi.fn(),
    }
    const onKeyDown = createReaderShortcutHandler(handlers)
    const div = document.createElement('div')

    onKeyDown(keyEvent('n', div))
    onKeyDown(keyEvent('P', div))
    onKeyDown(keyEvent('h', div))
    onKeyDown(keyEvent('C', div))

    expect(handlers.onNextPage).toHaveBeenCalledTimes(1)
    expect(handlers.onPrevPage).toHaveBeenCalledTimes(1)
    expect(handlers.onHighlight).toHaveBeenCalledTimes(1)
    expect(handlers.onCreateCard).toHaveBeenCalledTimes(1)
  })

  it('ignores an absent handler without throwing', () => {
    const onKeyDown = createReaderShortcutHandler({})
    expect(() => onKeyDown(keyEvent('h', document.createElement('div')))).not.toThrow()
  })

  it('ignores an unrelated key and does not call preventDefault', () => {
    const onNextPage = vi.fn()
    const onKeyDown = createReaderShortcutHandler({ onNextPage })
    const event = keyEvent('x', document.createElement('div'))
    onKeyDown(event)
    expect(onNextPage).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not fire while typing in a search box or a note field', () => {
    const onHighlight = vi.fn()
    const onKeyDown = createReaderShortcutHandler({ onHighlight })

    const input = document.createElement('input')
    onKeyDown(keyEvent('h', input))
    expect(onHighlight).not.toHaveBeenCalled()

    const textarea = document.createElement('textarea')
    onKeyDown(keyEvent('h', textarea))
    expect(onHighlight).not.toHaveBeenCalled()

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    onKeyDown(keyEvent('h', editable))
    expect(onHighlight).not.toHaveBeenCalled()
  })

  it('still fires when the target is nested inside the reader but not an editable field', () => {
    const onCreateCard = vi.fn()
    const onKeyDown = createReaderShortcutHandler({ onCreateCard })
    const container = document.createElement('div')
    const page = document.createElement('span')
    container.appendChild(page)

    onKeyDown(keyEvent('c', page))
    expect(onCreateCard).toHaveBeenCalledTimes(1)
  })
})
