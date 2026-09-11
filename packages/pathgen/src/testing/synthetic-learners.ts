import type { ConfidenceLevel } from '@retenia/core'
import { difficultyLogitOf, sigmoid } from '../diagnostic/elo'
import { answerItem, type DiagnosticState, nextItem, startDiagnostic } from '../diagnostic/engine'
import { buildModuleGraph } from '../diagnostic/module-graph'
import { buildDiagnosticResult, type DiagnosticResult } from '../diagnostic/result'
import type {
  DiagnosticItem,
  ModuleGraph,
  ModuleStatus,
  SelfAssessmentLevel,
} from '../diagnostic/types'

/**
 * Synthetic learners for the diagnostic's acceptance test (`docs/spec/04-path-generation.md`
 * §10; sub-phase 8.5: "simulate 200 synthetic learners with known module states").
 *
 * The learner model is deliberately *not* the engine's own: the engine assumes
 * `P = σ(θ − d)`, while a learner here answers a 4-option MCQ, so even one who knows nothing
 * is right a quarter of the time; the item's real difficulty differs from the LLM's estimate
 * by N(0, 0.4); and declared confidence is correlated with the true state but noisy — known
 * learners slip, unknown ones are sometimes sure of a wrong answer. True states are
 * downward-closed on the prerequisite DAG, the Knowledge-Space-Theory assumption the
 * propagation rests on: a module is known only when all its prerequisites are.
 *
 * Seeded, so every run of the test sees the same 200 learners.
 */

export type Random = () => number

/** mulberry32 — small, fast and good enough for a simulation. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function gaussian(random: Random, mean: number, sd: number): number {
  const u = Math.max(random(), 1e-12)
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

function pick<T>(random: Random, table: readonly (readonly [T, number])[]): T {
  let x = random()
  for (const [value, weight] of table) {
    x -= weight
    if (x <= 0) return value
  }
  return (table[table.length - 1] as readonly [T, number])[0]
}

export interface SyntheticPath {
  readonly graph: ModuleGraph
  readonly items: readonly DiagnosticItem[]
}

/** Four items per module (difficulty 2, 3, 3, 4; one of them "apply"), one concept each. */
export const ITEMS_PER_MODULE = 4

/**
 * A path of `moduleCount` modules in sections of three or four, each module depending on one
 * or two of the four before it (15 % are roots), built through `buildModuleGraph` from a
 * concept graph so the lifting is exercised too.
 */
export function makeSyntheticPath(random: Random, moduleCount: number): SyntheticPath {
  const sections: { id: string; modules: { id: string; conceptIds: string[] }[] }[] = []
  const concepts: { concept_id: string; importance: number }[] = []
  const edges: { from: string; to: string; kind: string; confidence: number }[] = []
  const ids: string[] = []
  let sectionSize = 0
  for (let index = 0; index < moduleCount; index++) {
    if (sections.length === 0 || sectionSize >= 3 + Math.floor(random() * 2)) {
      sections.push({ id: `S${String(sections.length + 1).padStart(2, '0')}`, modules: [] })
      sectionSize = 0
    }
    sectionSize++
    const id = `M${String(index + 1).padStart(2, '0')}`
    const conceptIds = Array.from({ length: ITEMS_PER_MODULE }, (_, j) => `${id}.c${j}`)
    const importance = 0.3 + random() * 0.6
    for (const conceptId of conceptIds) concepts.push({ concept_id: conceptId, importance })
    ;(sections[sections.length - 1] as (typeof sections)[number]).modules.push({ id, conceptIds })
    if (index > 0 && random() < 0.85) {
      const count = random() < 0.35 ? 2 : 1
      for (let k = 0; k < count; k++) {
        const parent = ids[Math.max(0, index - 1 - Math.floor(random() * 4))] as string
        edges.push({ from: `${parent}.c0`, to: `${id}.c0`, kind: 'PREREQ_OF', confidence: 0.9 })
      }
    }
    ids.push(id)
  }
  const graph = buildModuleGraph({ sections, concepts, edges })
  const items: DiagnosticItem[] = []
  for (const module of graph.modules) {
    ;[2, 3, 3, 4].forEach((difficulty, j) => {
      items.push({
        id: `${module.id}.i${j}`,
        moduleId: module.id,
        conceptIds: [`${module.id}.c${j}`],
        difficultyLogit: difficultyLogitOf(difficulty),
        bloom: j === 3 ? 'apply' : j === 0 ? 'remember' : 'understand',
        exposure: 0,
        misconceptionByOption: { b: `X${module.id}` },
      })
    })
  }
  return { graph, items }
}

export interface SyntheticLearner {
  readonly truth: ReadonlyMap<string, ModuleStatus>
  /** The learner's real θ per module, on the item-difficulty scale. */
  readonly theta: ReadonlyMap<string, number>
  readonly selfAssessment: Readonly<Record<string, SelfAssessmentLevel>>
}

/** θ of each true state: P(correct on a median item) ≈ 0.91 / 0.63 / 0.34 with the guess floor. */
const TRUE_THETA: Readonly<Record<ModuleStatus, readonly [number, number]>> = {
  known: [2, 0.4],
  partial: [0, 0.3],
  unknown: [-2, 0.4],
}

export function makeSyntheticLearner(random: Random, path: SyntheticPath): SyntheticLearner {
  const truth = new Map<string, ModuleStatus>()
  const ability = random()
  for (const module of path.graph.modules) {
    const parents = (path.graph.parents.get(module.id) ?? []).map(
      (id) => truth.get(id) as ModuleStatus,
    )
    let state: ModuleStatus
    if (parents.includes('unknown')) state = random() < 0.85 ? 'unknown' : 'partial'
    else if (parents.includes('partial')) state = random() < 0.5 ? 'partial' : 'unknown'
    else
      state = pick(random, [
        ['known', 0.25 + 0.6 * ability],
        ['partial', 0.2],
        ['unknown', 1],
      ])
    truth.set(module.id, state)
  }
  const theta = new Map<string, number>()
  for (const [id, state] of truth) {
    const [mean, sd] = TRUE_THETA[state]
    theta.set(id, gaussian(random, mean, sd))
  }

  // Self-assessment is optimistic, as §14 pitfall 10 warns: it tracks the share of the
  // section really known, one level too high a good part of the time. "Nunca lo vi" is only
  // ever said of a section the learner truly does not know.
  const selfAssessment: Record<string, SelfAssessmentLevel> = {}
  for (const sectionId of new Set(path.graph.modules.map((m) => m.sectionId))) {
    const modules = path.graph.modules.filter((m) => m.sectionId === sectionId)
    const known = modules.filter((m) => truth.get(m.id) === 'known').length / modules.length
    const allUnknown = modules.every((m) => truth.get(m.id) === 'unknown')
    selfAssessment[sectionId] = allUnknown
      ? pick(random, [
          ['never', 0.7],
          ['familiar', 0.3],
        ])
      : known >= 0.7
        ? pick(random, [
            ['master', 0.4],
            ['know', 0.6],
          ])
        : known >= 0.3
          ? pick(random, [
              ['know', 0.5],
              ['familiar', 0.5],
            ])
          : pick(random, [
              ['familiar', 0.7],
              ['know', 0.3],
            ])
  }
  return { truth, theta, selfAssessment }
}

const CONFIDENCE: Readonly<Record<string, readonly (readonly [ConfidenceLevel, number])[]>> = {
  'known+': [
    ['sure', 0.8],
    ['unsure', 0.15],
    ['guessed', 0.05],
  ],
  'partial+': [
    ['sure', 0.35],
    ['unsure', 0.45],
    ['guessed', 0.2],
  ],
  'unknown+': [
    ['sure', 0.1],
    ['unsure', 0.3],
    ['guessed', 0.6],
  ],
  'known-': [
    ['sure', 0.3],
    ['unsure', 0.5],
    ['guessed', 0.2],
  ],
  'partial-': [
    ['sure', 0.2],
    ['unsure', 0.5],
    ['guessed', 0.3],
  ],
  'unknown-': [
    ['sure', 0.15],
    ['unsure', 0.35],
    ['guessed', 0.5],
  ],
}

/** Four options, one of them right: what "no idea" scores. */
export const GUESS_FLOOR = 0.25
/** How far the LLM's difficulty estimate is from the item's real one (§14 pitfall 8). */
export const DIFFICULTY_NOISE = 0.4

export interface SyntheticResponse {
  readonly correct: boolean
  readonly confidence: ConfidenceLevel
  readonly timeMs: number
}

export function respond(
  random: Random,
  learner: SyntheticLearner,
  item: DiagnosticItem,
): SyntheticResponse {
  const state = learner.truth.get(item.moduleId) as ModuleStatus
  const theta = learner.theta.get(item.moduleId) as number
  const realDifficulty = item.difficultyLogit + gaussian(random, 0, DIFFICULTY_NOISE)
  const correct = random() < GUESS_FLOOR + (1 - GUESS_FLOOR) * sigmoid(theta - realDifficulty)
  const table = CONFIDENCE[`${state}${correct ? '+' : '-'}`] as readonly (readonly [
    ConfidenceLevel,
    number,
  ])[]
  return { correct, confidence: pick(random, table), timeMs: 15_000 + random() * 20_000 }
}

export interface SyntheticRun {
  readonly state: DiagnosticState
  readonly result: DiagnosticResult
  /** Items served from a section the learner said they had never seen. */
  readonly neverSeenAsked: number
}

/** One learner through one diagnostic, "ya sé parte" with their own self-assessment. */
export function runSyntheticDiagnostic(
  random: Random,
  path: SyntheticPath,
  learner: SyntheticLearner,
): SyntheticRun {
  let state = startDiagnostic({
    graph: path.graph,
    items: path.items,
    entry: 'partial',
    selfAssessment: learner.selfAssessment,
  })
  const sectionOf = new Map(path.graph.modules.map((m) => [m.id, m.sectionId]))
  let neverSeenAsked = 0
  for (let item = nextItem(state); item !== null; item = nextItem(state)) {
    if (learner.selfAssessment[sectionOf.get(item.moduleId) as string] === 'never') {
      neverSeenAsked++
    }
    const response = respond(random, learner, item)
    state = answerItem(state, {
      itemId: item.id,
      outcome: response.correct ? 'correct' : 'wrong',
      confidence: response.confidence,
      timeMs: response.timeMs,
      difficulty: item.difficultyLogit,
      chosenOptionId: response.correct ? 'a' : 'b',
    })
  }
  return { state, result: buildDiagnosticResult(state), neverSeenAsked }
}

export interface SimulationReport {
  readonly learners: number
  readonly modules: number
  /** Three-class exact match. */
  readonly accuracy: number
  /** Known vs not known — the decision that marks lessons completed and seeds memory. */
  readonly knownAccuracy: number
  /** Of the modules not truly known, the share the diagnostic called known. */
  readonly falseKnownRate: number
  readonly maxAsked: number
  readonly meanAsked: number
  readonly neverSeenAsked: number
  readonly confusion: Readonly<Record<string, number>>
}

export function simulate(options: {
  readonly learners: number
  readonly seed: number
  readonly sizes: readonly number[]
}): SimulationReport {
  const random = seededRandom(options.seed)
  let modules = 0
  let exact = 0
  let knownRight = 0
  let notKnown = 0
  let falseKnown = 0
  let maxAsked = 0
  let totalAsked = 0
  let neverSeenAsked = 0
  const confusion: Record<string, number> = {}
  for (let index = 0; index < options.learners; index++) {
    const size = options.sizes[index % options.sizes.length] as number
    const path = makeSyntheticPath(random, size)
    const learner = makeSyntheticLearner(random, path)
    const run = runSyntheticDiagnostic(random, path, learner)
    maxAsked = Math.max(maxAsked, run.result.asked)
    totalAsked += run.result.asked
    neverSeenAsked += run.neverSeenAsked
    for (const module of run.result.modules) {
      const truth = learner.truth.get(module.moduleId) as ModuleStatus
      modules++
      if (truth === module.status) exact++
      if ((truth === 'known') === (module.status === 'known')) knownRight++
      if (truth !== 'known') {
        notKnown++
        if (module.status === 'known') falseKnown++
      }
      const key = `${truth}->${module.status}`
      confusion[key] = (confusion[key] ?? 0) + 1
    }
  }
  return {
    learners: options.learners,
    modules,
    accuracy: exact / modules,
    knownAccuracy: knownRight / modules,
    falseKnownRate: notKnown === 0 ? 0 : falseKnown / notKnown,
    maxAsked,
    meanAsked: totalAsked / options.learners,
    neverSeenAsked,
    confusion,
  }
}
