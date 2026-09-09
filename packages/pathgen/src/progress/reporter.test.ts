import { describe, expect, it } from 'vitest'
import { createThrottledReporter, type ProgressEvent, silentProgress } from './reporter'
import { GENERATION_STAGES } from './stages'

function event(
  stage: ProgressEvent['stage'],
  done: number,
  total: number,
  runId = 'run-1',
): ProgressEvent {
  return { runId, stage, done, total, at: new Date(0) }
}

describe('createThrottledReporter()', () => {
  it('always passes a stage transition and a final event, and otherwise one per interval', () => {
    let now = 0
    const seen: string[] = []
    const reporter = createThrottledReporter(
      { report: (entry) => seen.push(`${entry.stage}:${entry.done}`) },
      { clock: { now: () => new Date(now) }, minIntervalMs: 100 },
    )
    reporter.report(event('extracting', 0, 10))
    reporter.report(event('extracting', 1, 10)) // same instant: dropped
    now = 50
    reporter.report(event('extracting', 2, 10)) // too soon: dropped
    now = 100
    reporter.report(event('extracting', 3, 10)) // interval elapsed: passes
    reporter.report(event('extracting', 10, 10)) // final: passes
    reporter.report(event('consolidating', 0, 1)) // transition: passes
    reporter.report(event('consolidating', 0, 1, 'run-2')) // another run: passes
    expect(seen).toEqual([
      'extracting:0',
      'extracting:3',
      'extracting:10',
      'consolidating:0',
      'consolidating:0',
    ])
  })

  it('defaults to a quarter of a second', () => {
    let now = 0
    const seen: number[] = []
    const reporter = createThrottledReporter(
      { report: (entry) => seen.push(entry.done) },
      { clock: { now: () => new Date(now) } },
    )
    reporter.report(event('extracting', 0, 10))
    now = 249
    reporter.report(event('extracting', 1, 10))
    now = 250
    reporter.report(event('extracting', 2, 10))
    expect(seen).toEqual([0, 2])
  })

  it('names the stages the wizard shows', () => {
    expect(GENERATION_STAGES).toEqual([
      'reading_sources',
      'extracting',
      'consolidating',
      'synthesizing',
      'synthesizing_modules',
      'sequencing',
      'persisting',
    ])
    expect(() => silentProgress.report(event('sequencing', 1, 1))).not.toThrow()
  })
})
