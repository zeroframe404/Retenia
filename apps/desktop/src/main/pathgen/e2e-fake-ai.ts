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
  MAKE_FLASHCARDS_SCHEMA_NAME,
  type ParsedModuleTask,
  parseModuleTask,
  SYNTHESIZE_MODULE_SCHEMA_NAME,
  SYNTHESIZE_OUTLINE_SCHEMA_NAME,
  WRITE_LESSON_SCHEMA_NAME,
} from '@retenia/pathgen'

/**
 * A deterministic, in-process stand-in for the P1/P2 calls, wired in only when
 * `RETENIA_E2E=1` (`docs/spec/04-path-generation.md` §13's Playwright acceptance: "wizard →
 * preview → freeze with fakes"). No network, no key, no real model — just enough of a real
 * answer, for each of the three schemas the pipeline asks for, that a real generation run
 * completes end to end and produces a draft worth previewing and freezing.
 *
 * Stage 7's three calls (sub-phase 8.3) are answered the same way, with one deliberate gap:
 * P4 only knows how to write a `choice` exercise — a whole one, four options with feedback on
 * every one, so it survives `mcqIssue` and the E2E run really does compose a practice block.
 * Every other family gets the empty object
 * below, which fails validation and is reported as a rejected candidate — so the E2E run
 * exercises the *real* over-generation filter, including what it does with a thin pool, rather
 * than a path where every family happens to succeed. Teaching this fake all ten MVP payload
 * shapes would be re-implementing `packages/activity-schema` in a test double.
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

/** The cite ids a lesson's task listed under `citable`, so the fake can cite a real one. */
const CITE_ID = /^- (B\d{1,3}) \(/gm

function citeIdsFrom(prompt: string): string[] {
  return [...prompt.matchAll(CITE_ID)]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined)
}

function lessonAnswer(request: TextGenerationRequest) {
  const [cite] = citeIdsFrom(request.prompt)
  const citations = cite === undefined ? [] : [cite]
  const block = (type: string, content: string, cited: boolean) => ({
    type,
    content,
    citations: cited ? citations : [],
    diagram: null,
    misconception_id: null,
  })
  return {
    blocks: [
      block('hook', 'Al terminar vas a poder explicar el concepto de esta lección.', false),
      block(
        'explanation',
        `El concepto se explica en la fuente${cite === undefined ? '' : ` [cite:${cite}]`}.`,
        true,
      ),
      block('summary', '- Un punto\n- Otro punto\n- Un tercero', true),
    ],
    glossary: [],
    word_count: 700,
    warnings: [],
  }
}

function flashcardAnswer(request: TextGenerationRequest) {
  const [cite] = citeIdsFrom(request.prompt)
  return {
    flashcards: [
      {
        type: 'basic',
        front: '¿Qué explica esta lección?',
        back: 'El concepto de la fuente',
        cloze_text: null,
        context_cue: null,
        concept_ids: ['e2e-concept'],
        importance: 'normal',
        interference_group: null,
        as_of: null,
        citations: cite === undefined ? [] : [cite],
      },
    ],
    skipped: [],
  }
}

function activitiesAnswer() {
  return {
    candidates: [
      {
        bloom: 'understand',
        misconception_ids: [],
        activity: {
          schemaVersion: 1,
          type: 'mcq_single',
          family: 'choice',
          lang: 'es-AR',
          prompt: '¿Qué afirma la lección?',
          skills: ['e2e-concept'],
          difficulty: 2,
          grading: { method: 'det' },
          review: { eligible: true, ratingStrategy: 'binary', expectedSeconds: 12 },
          explanation: 'La primera opción es la que la lección explica.',
          payload: {
            family: 'choice',
            sets: [
              {
                id: 's1',
                multiple: false,
                options: [
                  { id: 'a', text: 'Lo que la fuente dice', correct: true, feedback: 'Correcto.' },
                  {
                    id: 'b',
                    text: 'Lo contrario',
                    correct: false,
                    feedback: 'La fuente dice lo opuesto.',
                  },
                  {
                    id: 'c',
                    text: 'Algo que la fuente no dice',
                    correct: false,
                    feedback: 'No aparece en la fuente.',
                  },
                  {
                    id: 'd',
                    text: 'Una versión exagerada de lo mismo',
                    correct: false,
                    feedback: 'Va más lejos de lo que la fuente afirma.',
                  },
                ],
              },
            ],
          },
        },
      },
    ],
    notes: [],
  }
}

function answerFor(request: TextGenerationRequest): object {
  if (request.schemaName === EXTRACT_CHUNK_SCHEMA_NAME) return extractionAnswer()
  if (request.schemaName === SYNTHESIZE_OUTLINE_SCHEMA_NAME) return outlineAnswer(request)
  if (request.schemaName === SYNTHESIZE_MODULE_SCHEMA_NAME) return moduleAnswer(request)
  if (request.schemaName === WRITE_LESSON_SCHEMA_NAME) return lessonAnswer(request)
  if (request.schemaName === MAKE_FLASHCARDS_SCHEMA_NAME) return flashcardAnswer(request)
  // `make_activities_<family>`: only `choice` is written, for the reason in the module doc.
  if (request.schemaName === 'make_activities_choice') return activitiesAnswer()
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
