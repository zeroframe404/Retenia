import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileDropZone } from './file-drop-zone'

function makeFile(name: string) {
  return new File(['content'], name, { type: 'text/plain' })
}

describe('FileDropZone', () => {
  it('emits dropped files', () => {
    const onFiles = vi.fn()
    render(<FileDropZone label="Drop here" onFiles={onFiles} />)
    const zone = screen.getByTestId('file-drop-zone')
    const file = makeFile('book.pdf')
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('emits files chosen via the file input', () => {
    const onFiles = vi.fn()
    render(<FileDropZone label="Drop here" onFiles={onFiles} />)
    const file = makeFile('book.pdf')
    const input = screen.getByLabelText('Drop here') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('does not emit files while disabled', () => {
    const onFiles = vi.fn()
    render(<FileDropZone label="Drop here" onFiles={onFiles} disabled />)
    const input = screen.getByLabelText('Drop here') as HTMLInputElement
    expect(input).toBeDisabled()
  })
})
