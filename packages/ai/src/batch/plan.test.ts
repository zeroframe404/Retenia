import { describe, expect, it } from 'vitest'
import {
  BATCH_MIN_REQUESTS,
  chooseDispatch,
  type DispatchPolicyInput,
  SYNCHRONOUS_HEAD,
  splitSynchronousHead,
} from './plan'

const base: DispatchPolicyInput = {
  batchable: true,
  count: 40,
  userWaiting: false,
  batchSupported: true,
}

describe('chooseDispatch', () => {
  it('batches a large run nobody is waiting on', () => {
    expect(chooseDispatch(base)).toBe('batch')
  })

  it('never batches while the user is waiting', () => {
    // The pitfall this rule exists for (`04-path-generation.md` §14, no. 18): a batch may take
    // 24 h, and "Regenerate this lesson" is a button somebody just pressed.
    expect(chooseDispatch({ ...base, userWaiting: true })).toBe('sync')
  })

  it('never batches work the caller has not said is batchable', () => {
    expect(chooseDispatch({ ...base, batchable: false })).toBe('sync')
  })

  it('needs five requests before the discount is worth the latency', () => {
    expect(chooseDispatch({ ...base, count: BATCH_MIN_REQUESTS - 1 })).toBe('sync')
    expect(chooseDispatch({ ...base, count: BATCH_MIN_REQUESTS })).toBe('batch')
  })

  it('stays synchronous when the batch would only be a sequential run in disguise', () => {
    // All of the bookkeeping and none of the -50 %: on a provider with no Batch API the
    // synchronous path is the same work, sooner.
    expect(chooseDispatch({ ...base, batchSupported: false })).toBe('sync')
  })
})

describe('splitSynchronousHead', () => {
  it('runs the first two and batches the rest', () => {
    const items = Array.from({ length: 40 }, (_, index) => index)
    const { head, rest } = splitSynchronousHead(items)

    expect(SYNCHRONOUS_HEAD).toBe(2)
    expect(head).toEqual([0, 1])
    expect(rest).toHaveLength(38)
    expect(rest[0]).toBe(2)
  })

  it('never asks for more head than there is', () => {
    const { head, rest } = splitSynchronousHead([1], 5)
    expect(head).toEqual([1])
    expect(rest).toEqual([])
  })

  it('takes a head of zero for a run with nothing to show first', () => {
    const { head, rest } = splitSynchronousHead([1, 2, 3], 0)
    expect(head).toEqual([])
    expect(rest).toEqual([1, 2, 3])
  })
})
