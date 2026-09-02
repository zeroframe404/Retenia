import { describe, expect, it } from 'vitest'
import { shouldOpenExternally } from './navigation'

describe('shouldOpenExternally', () => {
  it.each(['https://retenia.app/docs', 'mailto:hola@retenia.app'])('opens %s', (url) => {
    expect(shouldOpenExternally(url)).toBe(true)
  })

  it.each([
    ['plaintext http, which is a downgrade', 'http://retenia.app'],
    ['the local filesystem', 'file:///etc/passwd'],
    ['script urls', 'javascript:alert(1)'],
    ['the app itself', 'app://retenia/index.html'],
    ['another app protocol', 'ms-msdt:/id'],
    ['nonsense', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(shouldOpenExternally(url)).toBe(false)
  })
})
