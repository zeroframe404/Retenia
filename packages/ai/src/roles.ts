import { AiError } from './errors'
import type { ProviderProfile } from './profiles'
import type { ProviderRole } from './provider-port'

/**
 * Which model answers for which role, and in what order when the first one will not
 * (`docs/spec/06-ai-providers.md` §4's provider matrix, §6's "roles mapped by the user").
 *
 * The mapping is data, never a hardcoded model id in a feature: a caller asks for `cheap`
 * and never learns which provider served it.
 */

export interface ModelRef {
  readonly profileId: string
  readonly modelId: string
}

export interface RoleConfig {
  readonly primary: ModelRef
  /** Tried in order, each only after the primary has exhausted its attempts. */
  readonly fallbacks: readonly ModelRef[]
}

/**
 * Partial on purpose. `vision` and `audio` are not merely unconfigured but *unreachable*:
 * `TextGenerationRequest` carries no image, PDF or audio part, so they arrive with the
 * request shape that does (11.x, 12.x). `local` is 7.4's. `embed` is never routable at all
 * — see `resolveTargets`.
 */
export type RoleMap = Partial<Record<ProviderRole, RoleConfig>>

export interface AiRegistry {
  readonly profiles: readonly ProviderProfile[]
  readonly roles: RoleMap
}

export interface RoleTarget {
  readonly profile: ProviderProfile
  readonly modelId: string
}

const SONNET: ModelRef = Object.freeze({ profileId: 'anthropic', modelId: 'claude-sonnet-5' })
const HAIKU: ModelRef = Object.freeze({ profileId: 'anthropic', modelId: 'claude-haiku-4-5' })
const GEMINI_FLASH: ModelRef = Object.freeze({ profileId: 'google', modelId: 'gemini-3.7-flash' })

/**
 * The two chains the pedagogy judge may default to, each the complement of the other
 * (`docs/spec/04-path-generation.md` §5 gate 9: *"a model different from the generator"*,
 * §14 pitfall 16: *"biased judges"*). The first is the default when the lessons are written
 * by Sonnet 5; the second when they are written by Gemini. Every fallback differs from the
 * other chain's primary too, so a judge that falls back never lands on the generator.
 */
const JUDGE_CHAINS: readonly RoleConfig[] = Object.freeze([
  Object.freeze({ primary: GEMINI_FLASH, fallbacks: Object.freeze([HAIKU]) }),
  Object.freeze({ primary: SONNET, fallbacks: Object.freeze([HAIKU]) }),
])

/** `docs/spec/01-decisions.md` §3: Sonnet 5 generates, Gemini 3.7 Flash corrects and bulks. */
export const DEFAULT_ROLES: RoleMap = Object.freeze({
  smart: Object.freeze({
    primary: SONNET,
    fallbacks: Object.freeze([GEMINI_FLASH]),
  }),
  cheap: Object.freeze({
    primary: GEMINI_FLASH,
    fallbacks: Object.freeze([HAIKU]),
  }),
  /** The complement of `smart`'s Sonnet 5 — see `withJudgeDefault` for what happens when the
   *  user moves `smart` elsewhere. */
  judge: JUDGE_CHAINS[0] as RoleConfig,
})

/**
 * The reason a `judge` assignment is refused, or `null` when it is fine.
 *
 * Compared on the model id alone: the same model behind two profiles is still the same
 * judge of its own work. A map with no `smart` or no `judge` has nothing to conflict.
 */
export function judgeConflict(roles: RoleMap): string | null {
  const judge = roles.judge?.primary
  const generator = roles.smart?.primary
  if (judge === undefined || generator === undefined) return null
  return judge.modelId === generator.modelId
    ? 'the "judge" role must not run on the model that writes the lessons ' +
        `(${generator.profileId}/${generator.modelId}): docs/spec/04-path-generation.md §5 ` +
        'gate 9 asks for a model different from the generator'
    : null
}

/**
 * A role map whose `judge` is guaranteed to differ from its `smart` primary.
 *
 * An explicit judge that already differs is kept as it is — the user's choice wins. A map
 * with no judge, or whose judge collides with the generator (the user moved `smart` onto
 * the model the judge defaulted to), gets the complement of the generator: Gemini 3.7 Flash
 * when the lessons are written by Sonnet 5, Sonnet 5 when they are written by Gemini, and
 * for any other generator the first chain whose primary differs. Fallbacks are filtered the
 * same way. Returns the very same object when nothing needs deriving, so a caller comparing
 * against `DEFAULT_ROLES` by identity still can.
 */
export function withJudgeDefault(roles: RoleMap): RoleMap {
  const generator = roles.smart?.primary.modelId
  if (roles.judge !== undefined && judgeConflict(roles) === null) {
    // An explicit judge is kept as chosen — minus a fallback that would land the review on
    // the generator after all, which is the same bias one hop later.
    const fallbacks = roles.judge.fallbacks.filter((ref) => ref.modelId !== generator)
    return fallbacks.length === roles.judge.fallbacks.length
      ? roles
      : { ...roles, judge: { ...roles.judge, fallbacks } }
  }
  const chain =
    JUDGE_CHAINS.find((candidate) => candidate.primary.modelId !== generator) ??
    (JUDGE_CHAINS[0] as RoleConfig)
  return {
    ...roles,
    judge: {
      primary: chain.primary,
      fallbacks: chain.fallbacks.filter((ref) => ref.modelId !== generator),
    },
  }
}

/**
 * `embed` is deliberately not routable, and the message says why rather than leaving a
 * reader to discover the asymmetry the hard way.
 *
 * An embedding provider is not interchangeable with another the way a chat model is:
 * `retrieval.embeddingModel` is the single setting that decides the vector *space*, every
 * `embeddings` row records it and every KNN query filters on it. A fallback that silently
 * moved to a second model would write two incomparable spaces into one index, and nothing
 * would report an error — search would just quietly get worse. Cloud embedding providers
 * (7.4) are therefore selected by that setting, not by this map.
 */
const EMBED_MESSAGE =
  'the "embed" role is not routable: the embedding model is chosen by the ' +
  'retrieval.embeddingModel setting, because it decides the vector space every stored ' +
  'embedding is comparable within, and a fallback would silently mix two spaces in one index'

/**
 * The targets to try, in order, for this role.
 *
 * A ref whose profile is absent from the registry is dropped rather than being an error:
 * that is exactly how `ai.providers.allowlist` narrows the matrix — main hands in a
 * filtered profile list and the role degrades to whatever survives.
 */
export function resolveTargets(role: ProviderRole, registry: AiRegistry): readonly RoleTarget[] {
  if (role === 'embed') {
    throw new AiError('not_configured', EMBED_MESSAGE)
  }

  const byId = new Map(registry.profiles.map((profile) => [profile.id, profile]))
  const config = registry.roles[role]
  const refs = config === undefined ? [] : [config.primary, ...config.fallbacks]

  const targets: RoleTarget[] = []
  for (const ref of refs) {
    const profile = byId.get(ref.profileId)
    // A profile that does not list the model is a configuration error, not a routing one;
    // dropping it keeps the chain honest rather than sending a model the account cannot use.
    if (profile?.models.includes(ref.modelId)) {
      targets.push({ profile, modelId: ref.modelId })
    }
  }

  if (targets.length === 0) {
    throw new AiError(
      'not_configured',
      `no provider is configured for the "${role}" role` +
        (refs.length === 0
          ? ''
          : ` (${refs.map((r) => `${r.profileId}/${r.modelId}`).join(', ')} ` +
            'named, none available)'),
    )
  }
  return targets
}
