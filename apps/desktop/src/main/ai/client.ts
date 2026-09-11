import type {
  AiBudgetEvent,
  AiClient,
  AiRegistry,
  AiResultCache,
  ModelRef,
  PricingTable,
  ProviderInvoker,
  ProviderProfile,
  ProviderRole,
  RoleConfig,
  RoleMap,
} from '@retenia/ai'
import {
  createAiClient,
  createLocalProfile,
  DEFAULT_PROFILES,
  DEFAULT_ROLES,
  judgeConflict,
  realTimers,
  SHIPPED_PRICING,
  withJudgeDefault,
  withLocalPolicy,
  withLocalPreference,
} from '@retenia/ai'
import { createSdkInvoker } from '@retenia/ai/providers'
import type {
  AiCallRepository,
  AiResultRepository,
  BudgetAlertLatch,
  RoleAssignmentValue,
  SecretStore,
  SettingsRepository,
} from '@retenia/core'
import { net } from 'electron'
import { redactPaths } from '../jobs/redact'
import { log } from '../logging/log'

/**
 * The one place a stored API key becomes a configured model.
 *
 * `packages/ai` is deliberately ignorant of settings, of the database and of Electron: it
 * takes a secret reader, a recorder, two spend readers and a clock. This adapter is where
 * those become `SecretStore`, `AiCallRepository` and `SettingsRepository` — which is what
 * lets 7.5's settings screen be a diff in this file rather than in that package.
 *
 * It is **synchronous**, because `bootstrapJobs` is. That is possible only because the
 * profile registry is passed as a *resolver* rather than a value, so the allowlist is read
 * per run and a changed setting takes effect without a relaunch.
 */

/**
 * Narrowed with `Pick`, the way `packages/core`'s own services are: this adapter appends to
 * the cost log and reads two settings, and structurally cannot do anything else — no
 * updating a call, no writing a setting.
 */
export interface MainAiClientRepositories {
  aiCalls: Pick<AiCallRepository, 'record' | 'sumCost'>
  aiResults: Pick<AiResultRepository, 'findByCustomId' | 'put'>
  /** `'set'` is only ever used for the budget-alert latch (`ai.budget.lastAlertedThreshold`)
   *  — this adapter never writes any other setting. */
  settings: Pick<SettingsRepository, 'get' | 'set'>
}

export interface MainAiClientOptions {
  repos: MainAiClientRepositories
  secrets: Pick<SecretStore, 'getSecret'>
  /**
   * The provider seam, defaulting to the real AI SDK one.
   *
   * Overridden only by `client.test.ts`, so the wiring below — the allowlist, the two
   * settings reads, the path redaction, the budget event — can be driven end to end without
   * a network and without this package depending on the SDK it never imports directly.
   */
  invoker?: ProviderInvoker
  /**
   * Which profiles and roles this client resolves against. Defaults to the stored ones.
   *
   * Overriding the invoker alone is not enough to take a client off the network: role
   * resolution happens first, and it needs a *profile*, whose key `runOnce` then asks for.
   * A fresh test profile has none, so every target fails before the fake invoker is reached
   * ("every provider for the cheap role failed"). `RETENIA_E2E=1` passes both halves.
   */
  registry?: () => Promise<AiRegistry>
  /**
   * The merged pricing table this client bills against. Defaults to the shipped table.
   *
   * A plain value, not a resolver: `packages/ai`'s `AiClientOptions.pricing` is documented
   * as "7.5's price editor merges into this argument", so a changed overlay takes effect by
   * calling `createMainAiClient` again — `jobs/bootstrap.ts` holds the result in a
   * reassignable binding and rebuilds it on `ai.pricing.overlay`/`ai.setPricingOverlay`,
   * rather than this package growing a live-reload path of its own.
   */
  pricing?: PricingTable
  /**
   * The settings screen's budget banner/toast (`docs/spec/08-ux.md` §1: "monthly budget
   * with alerts"). Fired for every threshold crossing that the latch below has not already
   * recorded for this month — never for a `kind: 'blocked'` event, which the log line above
   * already covers and which fires on every over-cap call rather than once.
   */
  onBudgetAlert?: (alert: {
    period: string
    threshold: 80 | 100
    spentUsd: number
    capUsd: number
  }) => void
}

/**
 * `ai.providers.allowlist`'s first reader since it was declared in sub-phase 3.5.
 *
 * Empty means "all of them" rather than "none": an unset list is the default state, and
 * reading the default as a total block would make the app unusable until the user found a
 * setting they never knew existed.
 */
export function allowedProfiles(
  profiles: readonly ProviderProfile[],
  allowlist: readonly string[],
): readonly ProviderProfile[] {
  return allowlist.length === 0
    ? profiles
    : profiles.filter((profile) => allowlist.includes(profile.id))
}

/** `docs/spec/06-ai-providers.md` §7's local profile is always registered under this id. */
export const LOCAL_PROFILE_ID = 'local'

const PROVIDER_ROLES: ReadonlySet<ProviderRole> = new Set<ProviderRole>([
  'smart',
  'cheap',
  'judge',
  'vision',
  'audio',
  'embed',
  'local',
])

function isProviderRole(value: string): value is ProviderRole {
  return PROVIDER_ROLES.has(value as ProviderRole)
}

/**
 * `ai.providers.local.model` (7.4): a `RoleMap`/profile list built once per call, so a
 * changed setting — a different model loaded in Ollama, a role added to "prefer local" —
 * takes effect on the next call and never needs a relaunch, the same reasoning the
 * allowlist above already applies.
 *
 * An empty `ai.providers.local.model` means "not configured": no local profile is added,
 * and `ai.providers.local.preferRoles` is not consulted, so a role composed with an unset
 * local target never accidentally becomes local-only.
 */
export async function buildRegistry(
  repos: Pick<MainAiClientRepositories, 'settings'>,
): Promise<AiRegistry> {
  const allowlist = await repos.settings.get('ai.providers.allowlist')
  const localModel = await repos.settings.get('ai.providers.local.model')
  const localBaseUrl = await repos.settings.get('ai.providers.local.baseUrl')
  const storedRoles = (await repos.settings.get('ai.roles')) ?? {}

  if (localModel === '' || localModel === undefined) {
    const profiles = allowedProfiles(DEFAULT_PROFILES, allowlist)
    return {
      profiles,
      roles: withJudgeDefault(applyRoleOverrides(DEFAULT_ROLES, profiles, storedRoles)),
    }
  }

  const localProfile = createLocalProfile({
    id: LOCAL_PROFILE_ID,
    baseURL: localBaseUrl ?? '',
    models: [localModel],
  })
  const profiles = allowedProfiles([...DEFAULT_PROFILES, localProfile], allowlist)

  const preferRoles = (await repos.settings.get('ai.providers.local.preferRoles')) ?? []
  let roles = DEFAULT_ROLES
  for (const name of preferRoles) {
    if (isProviderRole(name)) {
      roles = withLocalPreference(roles, name, { profileId: LOCAL_PROFILE_ID, modelId: localModel })
    }
  }

  // Last, over everything the user and the local preference composed: the pedagogy judge
  // must never be the model that writes the lessons (`docs/spec/04-path-generation.md` §5
  // gate 9), so a `smart` override that lands on the judge's model re-derives the judge.
  return { profiles, roles: withJudgeDefault(applyRoleOverrides(roles, profiles, storedRoles)) }
}

/**
 * What `ai.setRoles` stores for the judge, given what the panel submitted.
 *
 * The panel submits *every* assignable role from `ai.getRoles`, and after `withJudgeDefault`
 * that answer carries the derived judge. So a user moving `smart` onto the judge's model
 * resubmits, unchanged, a judge that now collides — and refusing that would lock them out
 * of changing `smart` at all. The rule: a colliding judge the user did not touch (it equals
 * the judge the registry resolved before this write) is dropped from the stored map, so the
 * registry derives its complement again; a colliding judge the user *chose* is refused with
 * `judgeConflict`'s reason (`docs/spec/04-path-generation.md` §5 gate 9).
 */
export function settleJudgeAssignment(
  previousJudge: ModelRef | null,
  submitted: Readonly<Record<string, RoleAssignmentValue>>,
): { readonly stored: Record<string, RoleAssignmentValue>; readonly error: string | null } {
  const judge = submitted.judge?.primary ?? null
  const smart = submitted.smart?.primary ?? null
  if (judge === null || smart === null || judge.modelId !== smart.modelId) {
    return { stored: { ...submitted }, error: null }
  }
  const untouched =
    previousJudge !== null &&
    previousJudge.modelId === judge.modelId &&
    previousJudge.profileId === judge.profileId
  if (untouched) {
    const { judge: _dropped, ...rest } = submitted
    return { stored: rest, error: null }
  }
  return {
    stored: { ...submitted },
    error: judgeConflict({
      judge: { primary: judge, fallbacks: [] },
      smart: { primary: smart, fallbacks: [] },
    }),
  }
}

/**
 * The role-assignment panel's writes, laid over the local-preference roles computed above.
 *
 * An absent or empty entry for a role means "keep the incoming role", never "unset it" — a
 * user who never opens the role editor keeps working exactly as before this setting existed
 * (`docs/spec/08-ux.md` §1's role assignment dropdowns). `ai.setRoles` already validates every
 * profile/model pair against the live registry before persisting, so this never has to decide
 * what an invalid stored entry means — it can only ever find entries that already resolve.
 */
function applyRoleOverrides(
  roles: RoleMap,
  profiles: readonly ProviderProfile[],
  stored: Record<string, { primary: ModelRef | null; fallbacks: readonly ModelRef[] }>,
): RoleMap {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]))
  const resolves = (ref: ModelRef): boolean =>
    byId.get(ref.profileId)?.models.includes(ref.modelId) === true

  let next = roles
  for (const [role, assignment] of Object.entries(stored)) {
    if (!isProviderRole(role) || assignment.primary === null) continue
    if (!resolves(assignment.primary)) continue
    const fallbacks = assignment.fallbacks.filter(resolves)
    const config: RoleConfig = { primary: assignment.primary, fallbacks }
    next = next === roles ? { ...roles } : next
    next[role] = config
  }
  return next
}

/**
 * The read-compare-write behind `ai.budget.lastAlertedThreshold`.
 *
 * `crossedThresholds` (`packages/ai/src/budget.ts`) already edge-triggers within a single
 * `runOnce` call, so one request cannot fire twice for the same line. What it cannot see is
 * *two concurrent* requests each reading the month's spend before either has recorded its
 * own cost: both can independently observe `spentBefore < line <= spentAfter` and both then
 * call `onBudgetEvent` for the same threshold. This latch is the cross-request guard for
 * exactly that race, and it survives a restart the same way (a fresh process re-reads the
 * setting rather than assuming the threshold is new).
 *
 * The alert is emitted *before* the latch is persisted — a crash in between costs one
 * repeated toast next run, which is the safe direction to fail; losing the alert entirely
 * is not.
 */
async function maybeAlertBudgetThreshold(
  repos: MainAiClientRepositories,
  event: AiBudgetEvent,
  onBudgetAlert: MainAiClientOptions['onBudgetAlert'],
): Promise<void> {
  const threshold = event.threshold
  if (threshold === undefined) return

  try {
    const latch = await repos.settings.get('ai.budget.lastAlertedThreshold')
    const isNewMonth = latch.period !== event.period
    if (!isNewMonth && latch.threshold >= threshold) return

    onBudgetAlert?.({
      period: event.period,
      threshold,
      spentUsd: event.spentUsd,
      capUsd: event.capUsd,
    })

    const next: BudgetAlertLatch = { period: event.period, threshold }
    await repos.settings.set('ai.budget.lastAlertedThreshold', next)
  } catch (error) {
    log.error('[ai] could not check or persist the budget-alert latch', error)
  }
}

/**
 * The `ai_results` idempotency store, as an `AiResultCache`
 * (`docs/spec/04-path-generation.md` §7's "if a result exists, it is not repeated").
 *
 * Exported (not inlined into `createMainAiClient`) so `pathgen/bootstrap.ts` (sub-phase 8.2)
 * can hand a generation run the exact same cache this gateway reads and writes, rather than a
 * second adapter over the same table — a resumed run and the gateway's own dedup would
 * otherwise be two callers that happen to agree, instead of provably the same store.
 */
export function buildAiResultCache(
  repos: Pick<MainAiClientRepositories, 'aiResults'>,
): AiResultCache {
  return {
    get: async (customId) => {
      const row = await repos.aiResults.findByCustomId(customId)
      return row === undefined
        ? undefined
        : {
            customId: row.customId,
            output: row.output,
            model: row.model,
            provider: row.provider,
            costUsd: row.costUsd,
          }
    },
    put: async (result) => {
      await repos.aiResults.put({
        customId: result.customId,
        stage: result.stage,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion ?? null,
        schemaVersion: result.schemaVersion ?? null,
        output: result.output,
        costUsd: result.costUsd,
        hits: 0,
        lastHitAt: null,
        meta: null,
      })
    },
  }
}

export function createMainAiClient({
  repos,
  secrets,
  invoker,
  registry,
  pricing,
  onBudgetAlert,
}: MainAiClientOptions): AiClient {
  return createAiClient({
    // `net.isOnline()` gates every *cloud* target; a local target is never gated on it and
    // is instead raced against `withLocalPolicy`'s own clock (`docs/spec/08-ux.md` §1:
    // "Offline without surprises"). Only the default invoker is wrapped: `client.test.ts`'s
    // override is a scripted fake and has no connectivity or timeout concerns of its own.
    invoker:
      invoker ??
      withLocalPolicy(createSdkInvoker(), { timers: realTimers, isOnline: () => net.isOnline() }),

    registry: registry ?? (() => buildRegistry(repos)),
    pricing: pricing ?? SHIPPED_PRICING,

    getSecret: (name) => secrets.getSecret(name),

    recordCall: async (call) => {
      await repos.aiCalls.record({
        ...call,
        // A provider message can echo a path from a stack or a temp file. `redactPaths` is
        // the same helper job errors already go through before crossing IPC; the key itself
        // was removed upstream, by `redactKey`, where the plaintext was still in scope.
        error: call.error === null ? null : redactPaths(call.error),
      })
    },

    // `docs/spec/04-path-generation.md` §7's "if a result exists, it is not repeated",
    // wired. `buildAiResultCache` is also what `pathgen/bootstrap.ts` hands a generation run
    // (sub-phase 8.2), so a resumed run replays through the exact same store this gateway
    // already reads and writes.
    resultCache: buildAiResultCache(repos),

    spentSinceUsd: (from) => repos.aiCalls.sumCost({ from }),
    monthlyBudgetUsd: () => repos.settings.get('ai.budget.monthlyUsd'),
    hardBlockEnabled: () => repos.settings.get('ai.budget.hardBlock'),

    clock: { now: () => new Date() },

    onBudgetEvent: (event: AiBudgetEvent) => {
      const spent = event.spentUsd.toFixed(2)
      const cap = event.capUsd.toFixed(2)
      log.warn(
        event.kind === 'blocked'
          ? `[ai] the monthly budget is spent (USD ${spent} of ${cap}); ` +
              `blocking is ${event.purpose === undefined ? 'on' : `on for ${event.purpose}`}`
          : `[ai] the monthly AI budget is ${event.threshold ?? 0} % spent ` +
              `(USD ${spent} of ${cap}) for ${event.period}`,
      )

      if (event.kind === 'threshold' && event.threshold !== undefined) {
        void maybeAlertBudgetThreshold(repos, event, onBudgetAlert)
      }
    },

    logger: {
      warn: (message) => {
        log.warn(message)
      },
      error: (message, error) => {
        log.error(message, error)
      },
    },
  })
}
