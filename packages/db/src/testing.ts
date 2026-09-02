import { type Clock, createUuidV7Generator, type IdGenerator } from '@retenia/core'
import { migrate } from './migrator'
import {
  IN_MEMORY,
  type OpenDatabaseOptions,
  type OpenedDatabase,
  openDatabase,
} from './open-database'

/**
 * Helpers for tests in this package and in the packages that build on it (repositories,
 * importers, the desktop main process): an in-memory database with every migration applied,
 * a deterministic clock and id generator, and the audit columns filled in.
 */

export const TEST_DEVICE_ID = 'test-device'

/** `openDatabase(':memory:')` + `migrate()`. Close it in `afterEach`. */
export function openTestDatabase(options: OpenDatabaseOptions = {}): OpenedDatabase {
  const opened = openDatabase(IN_MEMORY, options)
  migrate(opened)
  return opened
}

export interface TestClock extends Clock {
  /** Moves the clock forward by `ms`. */
  advance(ms: number): void
  /** Current time in Unix ms. */
  nowMs(): number
}

/** A clock that only moves when told to. Starts at 2026-09-02T00:00:00Z by default. */
export function testClock(startMs: number = Date.UTC(2026, 8, 2)): TestClock {
  let current = startMs
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms
    },
    nowMs: () => current,
  }
}

/** A monotonic UUIDv7 generator over a `TestClock` (ids sort in creation order). */
export function testIds(clock: Clock = testClock()): IdGenerator {
  return createUuidV7Generator(clock)
}

/** The audit columns every domain table needs on insert. */
export function audit(nowMs: number, deviceId: string = TEST_DEVICE_ID) {
  return {
    createdAt: nowMs,
    updatedAt: nowMs,
    deletedAt: null,
    deviceId,
    version: 1,
  }
}
