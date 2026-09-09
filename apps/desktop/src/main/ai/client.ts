import type {
  AiBudgetEvent,
  AiClient,
  AiRegistry,
  ProviderInvoker,
  ProviderProfile,
  ProviderRole,
} from '@retenia/ai'
import {
  createAiClient,
  createLocalProfile,
  DEFAULT_PROFILES,
  DEFAULT_ROLES,
  realTimers,
  withLocalPolicy,
  withLocalPreference,
} from '@retenia/ai'
import { createSdkInvoker } from '@retenia/ai/providers'
import type {
  AiCallRepository,
  AiResultRepository,
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
  settings: Pick<SettingsRepository, 'get'>
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
export async function buildRegistry(repos: MainAiClientRepositories): Promise<AiRegistry> {
  const allowlist = await repos.settings.get('ai.providers.allowlist')
  const localModel = await repos.settings.get('ai.providers.local.model')
  const localBaseUrl = await repos.settings.get('ai.providers.local.baseUrl')

  if (localModel === '' || localModel === undefined) {
    return { profiles: allowedProfiles(DEFAULT_PROFILES, allowlist), roles: DEFAULT_ROLES }
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

  return { profiles, roles }
}

export function createMainAiClient({ repos, secrets, invoker }: MainAiClientOptions): AiClient {
  return createAiClient({
    // `net.isOnline()` gates every *cloud* target; a local target is never gated on it and
    // is instead raced against `withLocalPolicy`'s own clock (`docs/spec/08-ux.md` §1:
    // "Offline without surprises"). Only the default invoker is wrapped: `client.test.ts`'s
    // override is a scripted fake and has no connectivity or timeout concerns of its own.
    invoker:
      invoker ??
      withLocalPolicy(createSdkInvoker(), { timers: realTimers, isOnline: () => net.isOnline() }),

    registry: () => buildRegistry(repos),

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
    // wired. The adapter is this thin because the port was designed for it: `findByCustomId`
    // counts its own hit, and `put` replaces rather than inserts so a forced regeneration
    // does not leave the answer it was asked to discard sitting in front of the new one.
    resultCache: {
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
    },

    spentSinceUsd: (from) => repos.aiCalls.sumCost({ from }),
    monthlyBudgetUsd: () => repos.settings.get('ai.budget.monthlyUsd'),
    hardBlockEnabled: () => repos.settings.get('ai.budget.hardBlock'),

    clock: { now: () => new Date() },

    onBudgetEvent: (event: AiBudgetEvent) => {
      // The log is the whole surface for now. 7.5 adds the dashboard and the durable latch,
      // and 13.3 the notification; both need a UI this build does not have.
      const spent = event.spentUsd.toFixed(2)
      const cap = event.capUsd.toFixed(2)
      log.warn(
        event.kind === 'blocked'
          ? `[ai] the monthly budget is spent (USD ${spent} of ${cap}); ` +
              `blocking is ${event.purpose === undefined ? 'on' : `on for ${event.purpose}`}`
          : `[ai] the monthly AI budget is ${event.threshold ?? 0} % spent ` +
              `(USD ${spent} of ${cap}) for ${event.period}`,
      )
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
