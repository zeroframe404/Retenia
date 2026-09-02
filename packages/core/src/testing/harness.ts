import type {
  Activity,
  Card,
  Chunk,
  IdGenerator,
  KnowledgeItem,
  LearningPath,
  Lesson,
  Module,
  NewEntity,
  OutboxEntry,
  PathVersion,
  ReviewLog,
  Section,
  Source,
  UnitOfWork,
} from '../index'

/**
 * What a repository adapter must provide for the shared contract suites to run against it.
 *
 * The suites know nothing about SQLite, Drizzle or any other storage: everything they need
 * comes through this harness, so a future `expo-sqlite`, `sqlite-wasm` or PowerSync adapter
 * proves itself by passing exactly the same tests.
 */

/** A clock the suites can move, so "buried until tomorrow" is testable without waiting. */
export interface ControllableClock {
  now(): Date
  advance(ms: number): void
}

/**
 * FK-safe builders. Every table in the schema declares its foreign keys and they are
 * enforced (`PRAGMA foreign_keys = ON`), so a suite that wants a card needs an item first,
 * and a review log needs a card. Each builder creates whatever parent is missing, so the
 * suites stay about behaviour rather than about seeding order.
 */
export interface ContractSeeds {
  source(overrides?: Partial<NewEntity<Source>>): Promise<Source>
  chunk(overrides?: Partial<NewEntity<Chunk>>): Promise<Chunk>
  knowledgeItem(overrides?: Partial<NewEntity<KnowledgeItem>>): Promise<KnowledgeItem>
  card(overrides?: Partial<NewEntity<Card>>): Promise<Card>
  reviewLog(overrides?: Partial<NewEntity<ReviewLog>>): Promise<ReviewLog>
  path(overrides?: Partial<NewEntity<LearningPath>>): Promise<LearningPath>
  pathVersion(overrides?: Partial<NewEntity<PathVersion>>): Promise<PathVersion>
  section(overrides?: Partial<NewEntity<Section>>): Promise<Section>
  module(overrides?: Partial<NewEntity<Module>>): Promise<Module>
  lesson(overrides?: Partial<NewEntity<Lesson>>): Promise<Lesson>
  activity(overrides?: Partial<NewEntity<Activity>>): Promise<Activity>
}

/** What an adapter can and cannot do, so a suite skips rather than fails on a capability
 *  the adapter legitimately lacks (an in-memory adapter has no vector index). */
export interface ContractCapabilities {
  /** The adapter has a vector index, so `search({ mode: 'vector' | 'hybrid' })` works. */
  vectorSearch: boolean
  /** The adapter enforces the schema's CHECK constraints, so the append-only guarantee can
   *  be probed with a raw write. */
  checkConstraints: boolean
}

export interface ContractContext {
  repos: UnitOfWork
  clock: ControllableClock
  ids: IdGenerator
  seed: ContractSeeds
  capabilities: ContractCapabilities
  /** Every outbox row, oldest first. Empty whenever the adapter was built with the flag off. */
  listOutbox(): Promise<readonly OutboxEntry[]>
  /** Live row count straight from storage, bypassing the repositories — this is how the
   *  suites prove a soft delete really did not remove anything. */
  countRows(table: string): Promise<number>
  dispose(): Promise<void>
}

export interface HarnessOptions {
  outboxEnabled?: boolean
}

export interface RepositoryContractHarness {
  /** Shown in the `describe` title, e.g. `sqlite (better-sqlite3)`. */
  name: string
  create(options?: HarnessOptions): Promise<ContractContext>
}
