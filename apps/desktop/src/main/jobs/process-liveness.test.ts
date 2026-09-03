import { describe, expect, it, vi } from 'vitest'
import { nodeProcessLiveness } from './process-liveness'

describe('nodeProcessLiveness', () => {
  it('reports this process as alive', () => {
    expect(nodeProcessLiveness.isAlive(process.pid)).toBe(true)
  })

  it('reports a pid nothing owns as dead', () => {
    // Above the default `pid_max` on Linux and far past anything Windows hands out.
    expect(nodeProcessLiveness.isAlive(4_194_305)).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'treats %p as dead rather than passing it to process.kill',
    (pid) => {
      // `process.kill(0, 0)` signals the whole process *group* on POSIX; a pid that could
      // never have come out of a lease must not reach it.
      expect(nodeProcessLiveness.isAlive(pid)).toBe(false)
    },
  )

  it('counts a process it may not signal as alive — it exists, it is just not ours', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('operation not permitted') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })
    try {
      expect(nodeProcessLiveness.isAlive(1)).toBe(true)
    } finally {
      kill.mockRestore()
    }
  })

  it('counts ESRCH as dead', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('no such process') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    })
    try {
      expect(nodeProcessLiveness.isAlive(1234)).toBe(false)
    } finally {
      kill.mockRestore()
    }
  })
})
