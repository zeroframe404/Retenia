import { DEFAULT_PROFILES } from '@retenia/ai'
import { describe, expect, it } from 'vitest'
import { createReplayBatchProvider, createReplayInvoker } from './replay'

const profile = DEFAULT_PROFILES.find(
  (entry) => entry.id === 'anthropic',
) as (typeof DEFAULT_PROFILES)[number]
const target = { profile, modelId: 'claude-sonnet-5', apiKey: 'k' }

describe('createReplayInvoker()', () => {
  it('answers by the request and counts, and throws on a miss', async () => {
    const replay = createReplayInvoker((request) =>
      request.idempotencyKey === 'a' ? '{"ok":1}' : undefined,
    )
    const outcome = await replay.invoker(
      target,
      { prompt: 'p', temperature: 0, idempotencyKey: 'a' },
      { signal: undefined },
    )
    expect(outcome).toMatchObject({
      kind: 'ok',
      text: '{"ok":1}',
      modelId: 'claude-sonnet-5',
      finishReason: 'stop',
    })
    expect(replay.answered).toEqual(['a'])
    await expect(
      replay.invoker(
        target,
        { prompt: 'p', temperature: 0, idempotencyKey: 'b' },
        { signal: undefined },
      ),
    ).rejects.toThrow('no golden answer for b')
    await expect(
      replay.invoker(target, { prompt: 'p', temperature: 0 }, { signal: undefined }),
    ).rejects.toThrow('(no custom id)')
    expect(replay.calls).toHaveLength(3)
  })
})

describe('createReplayBatchProvider()', () => {
  it('answers a whole batch after the scripted number of polls, failing the unanswerable items', async () => {
    const replay = createReplayBatchProvider(
      (request) => (request.prompt === 'yes' ? 'ok' : undefined),
      {
        pollsBeforeDone: 2,
      },
    )
    const submission = await replay.provider.submit(
      target,
      [
        { customId: 'one', request: { prompt: 'yes', temperature: 0 } },
        { customId: 'two', request: { prompt: 'no', temperature: 0 } },
      ],
      { signal: undefined },
    )
    expect(submission.providerBatchId).toBe('replay-1')
    expect(replay.submitted).toHaveLength(1)
    expect(await replay.provider.poll(target, 'replay-1', { signal: undefined })).toMatchObject({
      status: 'in_progress',
      processing: 2,
    })
    expect(await replay.provider.poll(target, 'replay-1', { signal: undefined })).toMatchObject({
      status: 'in_progress',
    })
    const done = await replay.provider.poll(target, 'replay-1', { signal: undefined })
    expect(done.status).toBe('completed')
    expect(done.results.map((item) => [item.customId, item.outcome.kind])).toEqual([
      ['one', 'ok'],
      ['two', 'error'],
    ])
    expect(replay.polls()).toBe(3)
    await replay.provider.cancel(target, 'replay-1', { signal: undefined })
    expect(replay.cancelled).toEqual(['replay-1'])
    await expect(replay.provider.poll(target, 'nope', { signal: undefined })).rejects.toThrow(
      'no batch nope',
    )
  })
})
