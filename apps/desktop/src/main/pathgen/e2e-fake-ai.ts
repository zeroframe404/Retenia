import {
  type AiRegistry,
  createLocalProfile,
  type InvokeOutcome,
  type ProviderInvoker,
  type TextGenerationRequest,
  ZERO_USAGE,
} from '@retenia/ai'
import {
  EXTRACT_CHUNK_SCHEMA_NAME,
  type ParsedModuleTask,
  parseModuleTask,
  SYNTHESIZE_MODULE_SCHEMA_NAME,
  SYNTHESIZE_OUTLINE_SCHEMA_NAME,
} from '@retenia/pathgen'

/**
 * A deterministic, in-process stand-in for the P1/P2 calls, wired in only when
 * `RETENIA_E2E=1` (`docs/spec/04-path-generation.md` §13's Playwright acceptance: "wizard →
 * preview → freeze with fakes"). No network, no key, no real model — just enough of a real
 * answer, for each of the three schemas the pipeline asks for, that a real generation run
 * completes end to end and produces a draft worth previewing and freezing.
 *
 * The trick behind all three: `packages/pathgen` embeds what it wants an answer to be *about*
 * — the concept catalog, a module's own concept ids — in the request itself
 * (`request.cachePrefix` for the outline, `request.prompt` for a module; `parseModuleTask` is
 * pathgen's own exported reader for the module case). Reading them back means this fake never
 * has to hardcode ids that only pathgen's real consolidation step knows.
 */

export const E2E_PROFILE_ID = 'e2e-fake'
export const E2E_MODEL_ID = 'e2e-fake-model'

/** One `ProviderProfile` needing no stored key — the same shape `ai.providers.local.model`
 *  already uses for Ollama/LM Studio (`keyRef: null`). */
export function e2eFakeProfile() {
  return createLocalProfile({ id: E2E_PROFILE_ID, baseURL: '', models: [E2E_MODEL_ID] })
}

/** Routes both text roles at the fake profile — nothing else needs a role in this pipeline. */
export function e2eFakeRegistry(): AiRegistry {
  const target = { profileId: E2E_PROFILE_ID, modelId: E2E_MODEL_ID }
  const role = { primary: target, fallbacks: [] }
  return { profiles: [e2eFakeProfile()], roles: { smart: role, cheap: role } }
}

/** `concept_id | canonical | kind | imp … | diff … | first: "…"` — `conceptLine()`'s own
 *  format (`packages/pathgen/src/synthesize/inputs.ts`); only the leading id is needed here. */
const CONCEPT_LINE_ID = /^([^\s|]+) \|/gm

function conceptIdsFromPrefix(cachePrefix: string | undefined): string[] {
  if (cachePrefix === undefined) return []
  return [...cachePrefix.matchAll(CONCEPT_LINE_ID)]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined)
}

function extractionAnswer() {
  return {
    concepts: [
      {
        canonical: 'Concepto principal',
        aliases: [],
        definition: 'Definición de prueba generada por el proveedor falso de e2e.',
        kind: 'concept',
        importance: 0.9,
        difficulty: 2,
      },
      {
        canonical: 'Concepto secundario',
        aliases: [],
        definition: 'Segunda definición de prueba generada por el proveedor falso de e2e.',
        kind: 'concept',
        importance: 0.6,
        difficulty: 2,
      },
    ],
    claims: [],
    objectives: [{ text: 'Explicar el concepto principal', bloom: 'understand' }],
    prerequisites_mentioned: [],
    figures: [],
    exercises: [],
    is_frontmatter_like: false,
  }
}

function outlineAnswer(request: TextGenerationRequest) {
  const ids = conceptIdsFromPrefix(request.cachePrefix).slice(0, 40)
  const conceptIds = ids.length > 0 ? ids : ['e2e-fallback-concept']
  return {
    graph: {
      nodes: conceptIds.map((concept_id) => ({
        concept_id,
        bloom_target: 'understand',
        difficulty: 2,
        importance: 0.7,
      })),
      edges: [],
    },
    sections: [
      {
        title: 'Sección generada (e2e)',
        modules: [
          {
            title: 'Módulo generado (e2e)',
            objectives: [{ text: 'Explicar los conceptos del módulo', bloom: 'understand' }],
            concept_ids: conceptIds,
          },
        ],
      },
    ],
    excluded: [],
    warnings: [],
  }
}

function moduleAnswer(request: TextGenerationRequest) {
  const parsed: ParsedModuleTask | undefined = parseModuleTask(request.prompt)
  const conceptIds = (parsed?.conceptIds ?? []).slice(0, 10)
  return {
    lesson_specs: [
      {
        title: parsed === undefined ? 'Lección generada (e2e)' : `Lección: ${parsed.moduleTitle}`,
        concept_ids: conceptIds.length > 0 ? conceptIds : ['e2e-fallback-concept'],
        objectives: [{ text: 'Aplicar el concepto en un caso concreto', bloom: 'apply' }],
        estimated_minutes: 8,
      },
    ],
    misconceptions: [],
    warnings: [],
  }
}

function answerFor(request: TextGenerationRequest): object {
  if (request.schemaName === EXTRACT_CHUNK_SCHEMA_NAME) return extractionAnswer()
  if (request.schemaName === SYNTHESIZE_OUTLINE_SCHEMA_NAME) return outlineAnswer(request)
  if (request.schemaName === SYNTHESIZE_MODULE_SCHEMA_NAME) return moduleAnswer(request)
  // Outside pathgen's three P1/P2 calls this provider is never selected for a real feature
  // (nothing else routes a role at `E2E_PROFILE_ID`), so an empty object is a deliberate
  // "this should not happen" rather than a guess at some other schema's shape.
  return {}
}

/** The `ProviderInvoker` itself — synchronous in spirit, no timers, no retries needed. */
export function createE2eFakeInvoker(): ProviderInvoker {
  return async (target, request): Promise<InvokeOutcome> => ({
    kind: 'ok',
    text: JSON.stringify(answerFor(request)),
    modelId: target.modelId,
    usage: { ...ZERO_USAGE, inputTokens: 100, outputTokens: 100 },
    finishReason: 'stop',
  })
}
