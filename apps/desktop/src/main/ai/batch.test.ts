import type { AiBatchRecord, BatchProvider } from '@retenia/ai'
import { batchSuccess, createScriptedBatchProvider } from '@retenia/ai/testing'
import type { AiBatch, AiCall, AiResult, NewEntity, SecretName, SettingsMap } from '@retenia/core'
import type { AiBatchEvent } from '@retenia/ipc-contract'
import { describe, expect, it, vi } from 'vitest'

// The repo's usual reason for `vi.mock`: making the `electron` specifier resolve outside a
// real Electron process. `redactPaths` reads these paths to build its substitutions.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? '/home/ana' : `/home/ana/.config/${name}`),
    getAppPath: () => '/opt/Retenia/resources/app.asar',
  },
}))

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { createBatchesFacade, createMainBatchRunner, toBatchEvent } = await import('./batch')

/**
 * The main-process adapter for the Batch API: the `ai_batches` store, the tray projection and
 * the facade the `ai.*` channels call.
 *
 * `packages/ai` owns the state machine and tests it there; what is worth testing here is the
 * seam — that a partial patch does not blank the columns it omits, that the provider's own
 * job handle stays in main, and that a path in an error message is redacted before it can
 * reach a renderer.
 */

const SETTINGS: SettingsMap = {
  'ai.budget.monthlyUsd': 0,
  'ai.budget.hardBlock': true,
  'ai.providers.allowlist': [],
} as unknown as SettingsMap

const RECORD: AiBatchRecord = {
  id: '019213cd-0000-7000-8000-000000000001',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  role: 'smart',
  purpose: 'expand_lesson',
  stage: 'P3_write_lesson',
  status: 'in_progress',
  providerBatchId: 'msgbatch_01',
  requestCount: 38,
  succeededCount: 12,
  failedCount: 0,
  costEstimateUsd: 1.1,
  costUsd: 0.34,
  attempts: 4,
  submittedAt: new Date('2026-09-08T12:00:00Z'),
  nextPollAt: new Date('2026-09-08T12:05:00Z'),
  completedAt: null,
  promptVersion: '3',
  schemaVersion: 'lesson@1',
  error: null,
  createdAt: new Date('2026-09-08T11:59:00Z'),
}

/** An in-memory `ai_batches` repository with the same "undefined leaves it alone" rule. */
function repository() {
  const rows: AiBatch[] = []
  let counter = 0
  return {
    rows,
    repo: {
      create: async (input: NewEntity<AiBatch>): Promise<AiBatch> => {
        counter += 1
        const row = {
          ...input,
          id: `019213cd-0000-7000-8000-00000000000${counter}`,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          deletedAt: null,
          deviceId: 'device',
          version: 1,
        } as AiBatch
        rows.push(row)
        return row
      },
      update: async (id: string, patch: Partial<NewEntity<AiBatch>>): Promise<AiBatch> => {
        const at = rows.findIndex((row) => row.id === id)
        const current = rows[at]
        if (current === undefined) throw new Error(`no batch ${id}`)
        const next = { ...current } as Record<string, unknown>
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) next[key] = value
        }
        const row = next as unknown as AiBatch
        rows[at] = row
        return row
      },
      findById: async (id: string) => rows.find((row) => row.id === id),
      listActive: async () =>
        rows.filter((row) => !['completed', 'failed', 'cancelled'].includes(row.status)),
    },
  }
}

function harness(provider: BatchProvider, keys: Record<string, string> = { anthropic: 'sk-ant' }) {
  const store = repository()
  const calls: Array<NewEntity<AiCall>> = []
  const events: AiBatchEvent[] = []
  const answers = new Map<string, string>()

  const runner = createMainBatchRunner({
    repos: {
      aiBatches: store.repo,
      aiCalls: {
        record: async (call) => {
          calls.push(call)
          return call as unknown as AiCall
        },
        sumCost: async () => 0,
      },
      aiResults: {
        findByCustomId: async () => undefined,
        put: async (input: NewEntity<AiResult>) => {
          answers.set(input.customId, input.output)
          return input as unknown as AiResult
        },
      },
      settings: {
        get: async <K extends keyof SettingsMap>(key: K) => SETTINGS[key],
      },
    },
    secrets: { getSecret: async (name: SecretName) => keys[name] },
    ai: {
      textGenerator: () => async () => ({ text: 'sync', model: 'claude-sonnet-5' }),
      structured: (() => {}) as never,
      ratesFor: async () => undefined,
    },
    emit: (event) => events.push(event),
    // Without this the real Anthropic adapter would submit to `api.anthropic.com` from a
    // unit test.
    adapters: { anthropic: provider },
    fallback: provider,
  })

  return { runner, store, calls, events, answers, provider }
}

describe('toBatchEvent', () => {
  it('projects the row the tray needs and drops the provider job handle', () => {
    const event = toBatchEvent(RECORD)

    expect(event).toEqual({
      id: RECORD.id,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      purpose: 'expand_lesson',
      status: 'in_progress',
      requestCount: 38,
      succeededCount: 12,
      failedCount: 0,
      costEstimateUsd: 1.1,
      costUsd: 0.34,
      submittedAt: '2026-09-08T12:00:00.000Z',
      completedAt: null,
      error: null,
    })
    expect(event).not.toHaveProperty('providerBatchId')
    // Nor the polling columns: how main does its work is not the renderer's business.
    expect(event).not.toHaveProperty('nextPollAt')
    expect(event).not.toHaveProperty('attempts')
  })

  it('redacts a main-process path out of the error before it can cross', () => {
    const event = toBatchEvent({
      ...RECORD,
      status: 'failed',
      error: 'ENOENT: /home/ana/.config/userData/blobs/ab/cd',
    })

    expect(event.error).not.toContain('/home/ana')
  })
})

describe('the ai_batches store adapter', () => {
  it('creates a row in submitting, with nothing to poll yet', async () => {
    const scripted = createScriptedBatchProvider([])
    const test = harness(scripted.provider)

    await test.runner.submitBatch(
      { role: 'smart', purpose: 'expand_lesson', stage: 'P3_write_lesson' },
      [{ customId: 'a', request: { prompt: 'one', temperature: 0 } }],
    )

    const [row] = test.store.rows
    expect(row).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      role: 'smart',
      purpose: 'expand_lesson',
      stage: 'P3_write_lesson',
      requestCount: 1,
      succeededCount: 0,
      attempts: 0,
    })
    // The row exists before the provider is called, so a crash in that window is visible.
    expect(row?.costEstimateUsd).toBeGreaterThan(0)
    expect(test.events[0]?.status).toBe('submitting')
  })

  it('drives a batch from submission to reconciled answers, emitting a tray event each time', async () => {
    const scripted = createScriptedBatchProvider([
      { status: 'in_progress', results: [], processing: 2 },
      {
        status: 'completed',
        results: [batchSuccess('a', 'lesson a'), batchSuccess('b', 'lesson b')],
      },
    ])
    const test = harness(scripted.provider)

    const submitted = await test.runner.submitBatch(
      { role: 'smart', purpose: 'expand_lesson', stage: 'P3_write_lesson' },
      [
        { customId: 'a', request: { prompt: 'one', temperature: 0 } },
        { customId: 'b', request: { prompt: 'two', temperature: 0 } },
      ],
    )
    await test.runner.poll(submitted.id)
    const done = await test.runner.poll(submitted.id)

    expect(done?.status).toBe('completed')
    // The answers reached `ai_results` and the cost log got one row per request, through
    // this file's adapters rather than the runner's ports directly.
    expect([...test.answers.keys()].sort()).toEqual(['a', 'b'])
    expect(test.calls).toHaveLength(2)
    expect(test.calls[0]?.batchId).toBe(submitted.id)

    // submitting -> submitted -> in_progress -> completed, every one of them projected.
    expect(test.events.map((event) => event.status)).toEqual([
      'submitting',
      'submitted',
      'in_progress',
      'completed',
    ])
    for (const event of test.events) expect(event).not.toHaveProperty('providerBatchId')
  })

  it('completes a batch whose answers are all cached, without a provider call', async () => {
    // The store path with no network in it at all — §7's "if a result exists, it is not
    // repeated", which is also what a resumed generation run looks like.
    const scripted = createScriptedBatchProvider([])
    const test = harness(scripted.provider)
    const cached = new Map([['a', 'the answer']])

    const runner = createMainBatchRunner({
      repos: {
        aiBatches: test.store.repo,
        aiCalls: { record: async (call) => call as unknown as AiCall, sumCost: async () => 0 },
        aiResults: {
          findByCustomId: async (customId: string) =>
            cached.has(customId)
              ? ({
                  customId,
                  output: cached.get(customId) ?? '',
                  model: 'claude-sonnet-5',
                  provider: 'anthropic',
                  costUsd: 0.01,
                } as unknown as AiResult)
              : undefined,
          put: async (input: NewEntity<AiResult>) => input as unknown as AiResult,
        },
        settings: { get: async <K extends keyof SettingsMap>(key: K) => SETTINGS[key] },
      },
      secrets: { getSecret: async () => 'sk-ant' },
      ai: {
        textGenerator: () => async () => ({ text: 'sync', model: 'claude-sonnet-5' }),
        structured: (() => {}) as never,
        ratesFor: async () => undefined,
      },
      emit: () => {},
    })

    const submitted = await runner.submitBatch(
      { role: 'smart', purpose: 'expand_lesson', stage: 'P3_write_lesson' },
      [{ customId: 'a', request: { prompt: 'one', temperature: 0 } }],
    )

    expect(submitted.status).toBe('completed')
    expect(submitted.succeededCount).toBe(1)
    expect(scripted.submitted).toHaveLength(0)
  })

  it('leaves the columns a patch omits alone', async () => {
    const scripted = createScriptedBatchProvider([
      { status: 'in_progress', results: [], processing: 1 },
    ])
    const test = harness(scripted.provider)

    const submitted = await test.runner.submitBatch({ role: 'smart', purpose: 'expand_lesson' }, [
      { customId: 'a', request: { prompt: 'one', temperature: 0 } },
    ])
    await test.runner.poll(submitted.id)

    const row = test.store.rows[0]
    // A poll writes four columns. If the adapter turned the seventeen it omitted into nulls,
    // the batch would forget the provider handle it is addressed by and could never finish.
    expect(row).toMatchObject({
      status: 'in_progress',
      attempts: 1,
      providerBatchId: 'scripted-1',
      requestCount: 1,
      purpose: 'expand_lesson',
      costEstimateUsd: expect.any(Number),
    })
    expect(row?.submittedAt).not.toBeNull()
  })
})

describe('the batches facade', () => {
  it('lists active batches as tray summaries', async () => {
    const test = harness(createScriptedBatchProvider([]).provider)
    const facade = createBatchesFacade(test.runner)

    await test.runner.submitBatch({ role: 'smart', purpose: 'expand_lesson' }, [
      { customId: 'a', request: { prompt: 'one', temperature: 0 } },
    ])

    const listed = await facade.list()
    expect(listed).toHaveLength(1)
    for (const batch of listed) expect(batch).not.toHaveProperty('providerBatchId')
  })

  it('answers null for a batch nobody has', async () => {
    const test = harness(createScriptedBatchProvider([]).provider)
    const facade = createBatchesFacade(test.runner)
    expect(await facade.cancel('019213cd-0000-7000-8000-0000000000ff')).toBeNull()
  })
})
