import type { AiBudgetEvent, AiClient, ProviderInvoker, ProviderProfile } from '@retenia/ai'
import { createAiClient, DEFAULT_PROFILES, DEFAULT_ROLES } from '@retenia/ai'
import { createSdkInvoker } from '@retenia/ai/providers'
import type { AiCallRepository, SecretStore, SettingsRepository } from '@retenia/core'
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

export function createMainAiClient({ repos, secrets, invoker }: MainAiClientOptions): AiClient {
  return createAiClient({
    invoker: invoker ?? createSdkInvoker(),

    registry: async () => ({
      profiles: allowedProfiles(
        DEFAULT_PROFILES,
        await repos.settings.get('ai.providers.allowlist'),
      ),
      roles: DEFAULT_ROLES,
    }),

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
