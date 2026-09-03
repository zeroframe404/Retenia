import { describe, expect, it, vi } from 'vitest'

const paths: Record<string, string> = {
  userData: '/home/ada/.config/Retenia',
  home: '/home/ada',
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      const value = paths[name]
      if (value === undefined) throw new Error(`no path for ${name}`)
      return value
    },
    getAppPath: () => '/opt/Retenia/resources/app.asar',
  },
}))

const { redactPaths, redactPathsOrNull } = await import('./redact')

describe('redactPaths', () => {
  it('replaces the userData directory', () => {
    expect(
      redactPaths("ENOENT: no such file, open '/home/ada/.config/Retenia/blobs/ab/cd.pdf'"),
    ).toBe("ENOENT: no such file, open '<userData>/blobs/ab/cd.pdf'")
  })

  it('replaces the app directory', () => {
    expect(redactPaths('at /opt/Retenia/resources/app.asar/out/main/index.js:1:1')).toBe(
      'at <app>/out/main/index.js:1:1',
    )
  })

  /** `userData` is normally *inside* `home`, so the longer root has to win or the label
   *  would come out as `<home>/.config/Retenia/...` and leak the layout anyway. */
  it('prefers the most specific root when they nest', () => {
    expect(redactPaths('/home/ada/.config/Retenia/retenia.db')).toBe('<userData>/retenia.db')
  })

  it('still redacts a home path that is not under userData', () => {
    expect(redactPaths('/home/ada/Documents/book.pdf')).toBe('<home>/Documents/book.pdf')
  })

  it('replaces every occurrence, not just the first', () => {
    expect(redactPaths('/home/ada/a and /home/ada/b')).toBe('<home>/a and <home>/b')
  })

  /** Windows paths arrive in whatever case the caller used, over a case-insensitive drive,
   *  and Node mixes separators freely. */
  it('is case- and separator-insensitive', () => {
    expect(redactPaths('/HOME/ADA/.config/retenia/x')).toBe('<userData>/x')
    expect(redactPaths('\\home\\ada\\.config\\Retenia\\x')).toBe('<userData>\\x')
  })

  it('leaves text with no paths alone', () => {
    expect(redactPaths('ffmpeg exited with code 1')).toBe('ffmpeg exited with code 1')
  })

  it('passes null through', () => {
    expect(redactPathsOrNull(null)).toBeNull()
    expect(redactPathsOrNull('/home/ada/x')).toBe('<home>/x')
  })
})
