#!/usr/bin/env node
/**
 * `pnpm first-lesson`: sub-phase 8.3's manual acceptance, as a command.
 *
 * *"The first lesson of the fixture path is readable within 60 s with the live provider."*
 * That is a claim about latency against a real model, so no fake can check it and CI must
 * never run it — it is real API spend, exactly like `run-evals.mjs` next door, and it lives
 * here for the same reason. **It is deliberately not a `ci:local` step**: that script mirrors
 * `.github/workflows/ci.yml` step for step, and a step needing a paid key would make the gate
 * unrunnable for anyone without one.
 *
 * What it times is the synchronous head of stage 7 — P3, then P4, then P5, in the order
 * `expandLessons` runs them and with the same prompts, schemas and temperatures — because that
 * is what stands between freezing a path and having a lesson to read. What it does not do is
 * open a database: those writes are microseconds, and requiring them would drag a whole
 * Electron bootstrap into a measurement about three HTTP calls.
 *
 * With no key in the environment it prints "skipped" and exits 0, so it is safe to run
 * anywhere.
 */

import { createActivityAuthor } from '@retenia/activity-ai'
import { createAiClient, DEFAULT_PROFILES, DEFAULT_ROLES, realTimers } from '@retenia/ai'
import { createSdkInvoker } from '@retenia/ai/providers'
import {
  buildFlashcardRequest,
  buildLessonContext,
  buildTheoryRequest,
  parseGenerationConfig,
} from '@retenia/pathgen'
import { loadPathgenPrompts } from '@retenia/pathgen/node'

const BUDGET_SECONDS = 60
const MAX_SPEND_USD = Number(process.env.MAX_FIRST_LESSON_SPEND_USD ?? '0.50')

const SECRET_ENV = { anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY' }

if (Object.values(SECRET_ENV).every((name) => (process.env[name] ?? '') === '')) {
  console.log(
    'skipped: no provider key in the environment ' +
      `(set ${Object.values(SECRET_ENV).join(' or ')} to run the live acceptance).`,
  )
  process.exit(0)
}

/** One lesson's worth of a real book, with the one fragment it is allowed to cite. */
const CHUNK = {
  id: 'chunk-live-1',
  sourceId: 'src-live-book',
  headingPath: 'Memoria y aprendizaje > Cap. 2 > La memoria de trabajo',
  locator: { page: 41, block_ids: ['b-411', 'b-412'] },
  text: [
    'La memoria de trabajo es el sistema que mantiene disponible una pequeña cantidad de',
    'información mientras se la usa. Su capacidad ronda los cuatro elementos en adultos, no',
    'los siete que popularizó Miller en 1956: las estimaciones posteriores, con tareas que',
    'impiden el repaso subvocal, convergen en tres o cuatro. La información se pierde en',
    'segundos si no se la repasa, y compite por el mismo recurso que la tarea en curso, de',
    'modo que una consigna compleja deja menos capacidad para retener sus propios datos.',
  ].join('\n'),
}

const LESSON = {
  id: 'L01',
  kind: 'core',
  title: 'La capacidad de la memoria de trabajo',
  concept_ids: ['c-wm'],
  warmup_concept_ids: [],
  objectives: [
    {
      text: 'Explicar cuántos elementos retiene la memoria de trabajo y por qué',
      bloom: 'understand',
    },
  ],
  prerequisite_lesson_ids: [],
  estimated_minutes: 8,
  source_refs: [{ chunk_id: CHUNK.id, source_id: CHUNK.sourceId }],
  origin: 'model',
}

const GLOSSARY = [
  {
    conceptId: 'c-wm',
    name: 'Memoria de trabajo',
    definition: 'El retén breve que sostiene la información mientras se la usa.',
  },
]

const prompts = loadPathgenPrompts()
const config = parseGenerationConfig({
  goal: 'Entender cómo funciona la memoria y estudiar mejor',
  level: 'beginner',
  lessonLanguage: 'es-AR',
  sourceIds: [CHUNK.sourceId],
  primarySourceId: CHUNK.sourceId,
})

let spentUsd = 0
const ai = createAiClient({
  invoker: createSdkInvoker(),
  registry: async () => ({ profiles: DEFAULT_PROFILES, roles: DEFAULT_ROLES }),
  getSecret: async (name) => process.env[SECRET_ENV[name]],
  recordCall: async (call) => {
    spentUsd += call?.usage?.usd ?? 0
  },
  spentSinceUsd: async () => spentUsd,
  monthlyBudgetUsd: async () => MAX_SPEND_USD,
  clock: { now: () => new Date() },
  timers: realTimers,
  logger: { warn: () => {}, error: () => {} },
})

const context = buildLessonContext({
  lesson: LESSON,
  chunks: new Map([[CHUNK.id, CHUNK]]),
  retrieved: [],
  previous: [],
  glossary: GLOSSARY,
})

const seconds = (ms) => (ms / 1000).toFixed(1)
const started = Date.now()

async function stage(name, work) {
  const at = Date.now()
  try {
    const value = await work()
    console.log(`  ${name.padEnd(20)} ${seconds(Date.now() - at).padStart(6)} s`)
    return value
  } catch (error) {
    // A provider failure here is a configuration problem nine times out of ten — a key that is
    // not set, or set for a provider the role does not route to — and a stack trace through the
    // fallback chain buries the one line that says which.
    console.error('')
    console.error(`  ${name} failed after ${seconds(Date.now() - at)} s:`)
    console.error(`    ${error instanceof Error ? error.message : String(error)}`)
    const cause = error instanceof Error ? error.cause : undefined
    if (cause instanceof Error) console.error(`    caused by: ${cause.message}`)
    process.exit(1)
  }
}

console.log(
  `Live head-lesson acceptance — budget ${BUDGET_SECONDS} s, spend cap USD ${MAX_SPEND_USD}\n`,
)

const theory = await stage('P3 write_lesson', async () => {
  const request = buildTheoryRequest(
    { lesson: LESSON, context, config, targetLanguage: null, minutes: LESSON.estimated_minutes },
    prompts.lesson,
    0,
  )
  return ai.structured({ role: prompts.lesson.role, purpose: 'live-acceptance' })(
    request.structured,
  )
})

const author = createActivityAuthor({ prompt: prompts.activities })
const practice = await stage('P4 make_activities', async () => {
  const [call] = author.plan({
    lessonSpecId: LESSON.id,
    parentCustomId: 'live',
    lang: config.lessonLanguage,
    title: LESSON.title,
    objectives: LESSON.objectives,
    concepts: [{ id: 'c-wm', name: GLOSSARY[0].name, definition: GLOSSARY[0].definition }],
    blocks: theory.value.blocks.map((block) => ({ type: block.type, content: block.content })),
    misconceptions: [],
    families: ['choice'],
    wanted: 4,
    overGeneration: 2,
    alreadyGenerated: [],
    variant: 0,
  })
  if (call === undefined) throw new Error('P4 planned no call')
  const answer = await ai.structured({ role: prompts.activities.role, purpose: 'live-acceptance' })(
    call.structured,
  )
  return author.collect(call, answer.value)
})

const cards = await stage('P5 make_flashcards', async () => {
  const request = buildFlashcardRequest(
    {
      lessonSpecId: LESSON.id,
      title: LESSON.title,
      lang: config.lessonLanguage,
      blocks: theory.value.blocks,
      glossary: GLOSSARY,
      context,
      existingFronts: [],
    },
    prompts.flashcards,
    0,
  )
  return ai.structured({ role: prompts.flashcards.role, purpose: 'live-acceptance' })(
    request.structured,
  )
})

const took = Date.now() - started
const cited = theory.value.blocks.filter((block) => block.citations.length > 0).length

console.log('')
console.log(`  theory blocks        ${theory.value.blocks.length} (${cited} cited)`)
console.log(`  activities kept      ${practice.activities.length}`)
console.log(`  flashcards           ${cards.value.flashcards.length}`)
console.log(`  spent                USD ${spentUsd.toFixed(4)}`)
console.log('')

if (took > BUDGET_SECONDS * 1000) {
  console.error(
    `FAIL: the first lesson took ${seconds(took)} s, over the ${BUDGET_SECONDS} s budget.`,
  )
  process.exit(1)
}
console.log(`PASS: the first lesson was ready in ${seconds(took)} s.`)
