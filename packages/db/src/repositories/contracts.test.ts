import { runRepositoryContracts } from '@retenia/core/testing'
import { sqliteHarness } from './sqlite-harness'

/**
 * The shared contract suites, run against the SQLite adapter.
 *
 * There is nothing SQLite-specific here on purpose: a future `expo-sqlite`, `sqlite-wasm`
 * or PowerSync adapter adds its own harness and this same call, and passes or fails on the
 * same behaviour. Adapter-specific tests (query plans, raw constraint probes) live in
 * `sqlite.test.ts` instead.
 */
runRepositoryContracts(sqliteHarness)
