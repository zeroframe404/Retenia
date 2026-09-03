import { describe, expect, it } from 'vitest'
import { formatWorkerId, parseWorkerId } from './worker-id'

const lease = { runId: 'run-a', pid: 4242, workerId: 'w1' }

describe('worker lease encoding', () => {
  it('round trips a lease', () => {
    expect(parseWorkerId(formatWorkerId(lease))).toEqual(lease)
  })

  it('is readable in the database column', () => {
    expect(formatWorkerId({ runId: 'run-a', pid: 17, workerId: 'w0' })).toBe('w1:run-a:17:w0')
  })

  it('refuses to write a lease it could not read back', () => {
    expect(() => formatWorkerId({ ...lease, pid: 0 })).toThrow(/positive integer pid/)
    expect(() => formatWorkerId({ ...lease, pid: 1.5 })).toThrow(/positive integer pid/)
    expect(() => formatWorkerId({ ...lease, workerId: '' })).toThrow(/worker id/)
    // A ":" in either free-form part would make the lease ambiguous to parse.
    expect(() => formatWorkerId({ ...lease, workerId: 'a:b' })).toThrow(/worker id/)
    expect(() => formatWorkerId({ ...lease, runId: '' })).toThrow(/run id/)
    expect(() => formatWorkerId({ ...lease, runId: 'a:b' })).toThrow(/run id/)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['a bare worker id', 'worker-1'],
    ['the wrong prefix', 'pid:run-a:12:w1'],
    ['the older, run-less format', 'pid:12:w1'],
    ['too many parts', 'w1:run-a:12:w1:extra'],
    ['a non-numeric pid', 'w1:run-a:abc:w1'],
    ['a negative pid', 'w1:run-a:-3:w1'],
    ['no worker id', 'w1:run-a:12:'],
    ['no run id', 'w1::12:w1'],
  ])('reads %s as "not a lease we understand"', (_label, value) => {
    expect(parseWorkerId(value)).toBeUndefined()
  })

  /**
   * The reason the run id exists: pids are reused, so after a crash and restart the dead
   * worker's number can belong to an unrelated program. Two leases can therefore agree on
   * the pid and still be from different runs — and only the run id says so.
   */
  it('distinguishes two runs that happen to share a pid', () => {
    const before = parseWorkerId(formatWorkerId({ runId: 'run-a', pid: 500, workerId: 'w0' }))
    const after = parseWorkerId(formatWorkerId({ runId: 'run-b', pid: 500, workerId: 'w0' }))
    expect(before?.pid).toBe(after?.pid)
    expect(before?.runId).not.toBe(after?.runId)
  })
})
