import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { JobSummary } from '@retenia/ipc-contract'
import { callApi, callApiWith, expect, gotoReady, launchApp, test } from './fixtures'

/**
 * The background job queue, end to end through a real `utilityProcess`
 * (`docs/spec/07-architecture.md` §7).
 *
 * Everything below the IPC boundary is unit-tested elsewhere with fakes; what only a real
 * launch can prove is that a worker actually forks, that the port handshake completes, that
 * an `AbortSignal` crosses process boundaries, and that a database written by one run is
 * recovered by the next. Those are this file's four assertions.
 */

/**
 * Reads one job back off `jobs.list`, whatever state it is in.
 *
 * The status list is a literal *inside* the evaluated function rather than a parameter:
 * `callApi` serializes the callback over CDP, so anything it closes over from this file is
 * `undefined` in the page (see the note on `callApi` itself). Filtering by id happens here,
 * in Node, where closures work normally.
 */
async function readJob(window: Page, id: string): Promise<JobSummary | undefined> {
  const result = await callApi(window, (api) =>
    api.jobs.list({ statuses: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] }),
  )
  if (!result.ok) throw new Error(`jobs.list failed: ${result.error.message}`)
  return result.data.jobs.find((job) => job.id === id)
}

/** Collects `jobs.progress` pushes in the page, so the test can assert on what a real
 *  renderer would have received. */
async function collectProgress(window: Page): Promise<void> {
  await window.evaluate(() => {
    const seen: unknown[] = []
    ;(window as unknown as Record<string, unknown>).__jobProgress = seen
    window.api.events.on('jobs.progress', (event) => seen.push(event))
  })
}

test('hashFile runs in a utility process, reports progress and returns the real digest', async ({
  window,
}) => {
  await gotoReady(window)
  await collectProgress(window)

  // Main picks the file and hands back what it chose; the renderer never names a path.
  const enqueued = await callApi(window, (api) => api.jobs.enqueueDemo({ kind: 'hashFile' }))
  expect(enqueued.ok).toBe(true)
  if (!enqueued.ok) return
  expect(enqueued.data.job).not.toBeNull()

  const id = enqueued.data.job?.id as string
  const subject = enqueued.data.subject as string

  await expect
    .poll(async () => (await readJob(window, id))?.status, { timeout: 20_000 })
    .toBe('succeeded')

  const finished = await readJob(window, id)
  const expected = createHash('sha256')
    .update(await readFile(subject))
    .digest('hex')
  // The digest was computed in another process and travelled back over the port, through the
  // database, and across the IPC bridge to get here.
  expect(finished?.result).toEqual({
    sha256: expected,
    bytes: (await readFile(subject)).byteLength,
  })

  const events = (await window.evaluate(
    () => (window as unknown as Record<string, unknown>).__jobProgress,
  )) as { id: string; status: string; progress: number | null }[]
  const mine = events.filter((event) => event.id === id)
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.at(-1)?.status).toBe('succeeded')
})

test('cancelling a running job stops its worker', async ({ window }) => {
  await gotoReady(window)

  // Long enough that it cannot possibly finish on its own within the poll below.
  const enqueued = await callApi(window, (api) =>
    api.jobs.enqueueDemo({ kind: 'sleep', ms: 120_000 }),
  )
  expect(enqueued.ok).toBe(true)
  if (!enqueued.ok) return
  const id = enqueued.data.job?.id as string

  await expect
    .poll(async () => (await readJob(window, id))?.status, { timeout: 20_000 })
    .toBe('running')

  const cancelled = await callApiWith(window, ({ api, arg }) => api.jobs.cancel({ id: arg }), id)
  expect(cancelled.ok).toBe(true)

  await expect
    .poll(async () => (await readJob(window, id))?.status, { timeout: 20_000 })
    .toBe('cancelled')

  // The job stays cancelled: a worker that aborted mid-run reports an error afterwards, and
  // recording that would put the job back on the retry ladder.
  await window.waitForTimeout(1_000)
  expect((await readJob(window, id))?.status).toBe('cancelled')
})

test('the tray shows a running job', async ({ window }) => {
  await gotoReady(window)

  const enqueued = await callApi(window, (api) =>
    api.jobs.enqueueDemo({ kind: 'sleep', ms: 15_000 }),
  )
  expect(enqueued.ok).toBe(true)

  await expect(window.getByTestId('processing-tray-count')).toHaveText('1', { timeout: 20_000 })
})

/**
 * The acceptance criterion "restarting the app re-queues orphans", which needs two launches
 * over one database — so it drives its own `userData` directory rather than the per-test one
 * the `electronApp` fixture mints.
 */
test('restarting the app re-queues a job its worker died holding', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'retenia-orphan-'))

  try {
    const first = await launchApp(userDataDir)
    const firstWindow = await first.firstWindow()
    await firstWindow.waitForLoadState('domcontentloaded')
    await gotoReady(firstWindow)

    const enqueued = await callApi(firstWindow, (api) =>
      api.jobs.enqueueDemo({ kind: 'sleep', ms: 120_000 }),
    )
    expect(enqueued.ok).toBe(true)
    if (!enqueued.ok) return
    const id = enqueued.data.job?.id as string

    await expect
      .poll(async () => (await readJob(firstWindow, id))?.status, { timeout: 20_000 })
      .toBe('running')

    // SIGKILL, not `close()`: a graceful quit runs `before-quit`, which stops the runner and
    // closes the database in an orderly way. What orphan recovery exists for is the *other*
    // case — the app dying with work in flight and no chance to record anything — so the test
    // has to produce that, or it proves nothing.
    first.process().kill('SIGKILL')
    await first.close().catch(() => {
      // Already gone; `close` on a killed app rejects.
    })

    const second = await launchApp(userDataDir)
    const secondWindow = await second.firstWindow()
    await secondWindow.waitForLoadState('domcontentloaded')
    await gotoReady(secondWindow)

    try {
      // Recovery runs before any worker claims, so the job is either back in the queue or
      // already picked up again by this run — never still stranded as the dead run left it.
      await expect
        .poll(async () => (await readJob(secondWindow, id))?.attempts, {
          timeout: 20_000,
        })
        .toBeGreaterThan(1)
    } finally {
      await second.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})
