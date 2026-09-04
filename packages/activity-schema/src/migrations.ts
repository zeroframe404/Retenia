/**
 * `schemaVersion` migrations (`docs/spec/03-activities.md` §8: "schemaVersion migrations").
 *
 * Stored activities carry the version they were written with (`activities.schema_version`);
 * a reader upgrades them step by step to the version this package parses. The chain is
 * empty today — version 1 is the first — and `migrateActivity` is the seam the first real
 * migration plugs into. A migration is a pure JSON → JSON function: it never sees zod types,
 * because the old shape has no schema any more.
 */

export const CURRENT_SCHEMA_VERSION = 1

export interface ActivityMigration {
  from: number
  to: number
  migrate(json: unknown): unknown
}

/** One step per version bump, `from` ascending. Empty until version 2 exists. */
export const ACTIVITY_MIGRATIONS: readonly ActivityMigration[] = Object.freeze([])

export type ActivityMigrationReason = 'missing-version' | 'newer-version' | 'unsupported-version'

export class ActivityMigrationError extends Error {
  override readonly name = 'ActivityMigrationError'
  constructor(
    readonly reason: ActivityMigrationReason,
    message: string,
  ) {
    super(message)
  }
}

export interface MigrateActivityOptions {
  migrations?: readonly ActivityMigration[]
  /** The version to migrate to; defaults to the one this package parses. */
  target?: number
}

export interface MigratedActivity {
  activity: unknown
  from: number
  to: number
  /** The `from` versions of the steps applied, in order. Empty when nothing had to change. */
  applied: number[]
}

function readVersion(json: unknown): number | null {
  if (json === null || typeof json !== 'object') return null
  const version = (json as { schemaVersion?: unknown }).schemaVersion
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : null
}

/** Upgrades stored activity JSON to `target`, one migration step at a time. */
export function migrateActivity(
  json: unknown,
  options: MigrateActivityOptions = {},
): MigratedActivity {
  const { migrations = ACTIVITY_MIGRATIONS, target = CURRENT_SCHEMA_VERSION } = options
  const from = readVersion(json)
  if (from === null) {
    throw new ActivityMigrationError(
      'missing-version',
      'activity JSON has no integer schemaVersion ≥ 1',
    )
  }
  if (from > target) {
    throw new ActivityMigrationError(
      'newer-version',
      `activity is schemaVersion ${from}, newer than ${target}`,
    )
  }

  let activity = json
  let version = from
  const applied: number[] = []
  while (version < target) {
    const step = migrations.find((migration) => migration.from === version)
    if (step === undefined) {
      throw new ActivityMigrationError(
        'unsupported-version',
        `no migration from schemaVersion ${version}`,
      )
    }
    activity = step.migrate(activity)
    applied.push(version)
    version = step.to
  }
  return { activity, from, to: version, applied }
}
