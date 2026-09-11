import type { CoreLessonNode, ModuleNode, PathDraft, SectionNode } from '../schemas/path-draft'

/**
 * A small, hand-built `PathDraft.v1` for the editable-preview unit tests
 * (`packages/pathgen/src/edit/*.test.ts`, `freeze/freeze-path.test.ts`) — two sections, two
 * modules, a prerequisite chain across lessons, and both a reinforcement and a checkpoint, so
 * every edit op has something real to act on.
 */

export function lesson(id: string, overrides: Partial<CoreLessonNode> = {}): CoreLessonNode {
  return {
    id,
    kind: 'core',
    title: `Lección ${id}`,
    concept_ids: [`c_${id}_1`, `c_${id}_2`],
    warmup_concept_ids: [],
    objectives: [{ text: `Explicar ${id}`, bloom: 'understand' }],
    prerequisite_lesson_ids: [],
    estimated_minutes: 10,
    source_refs: [],
    origin: 'model',
    ...overrides,
  }
}

export function module(id: string, overrides: Partial<ModuleNode> = {}): ModuleNode {
  return {
    id,
    title: `Módulo ${id}`,
    objectives: [{ text: `Objetivo ${id}`, bloom: 'understand' }],
    concept_ids: [],
    lessons: [lesson(`${id}L1`), lesson(`${id}L2`, { prerequisite_lesson_ids: [`${id}L1`] })],
    reinforcement: {
      id: `${id}.reinf`,
      kind: 'reinforcement',
      module_id: id,
      concept_ids: [`c_${id}_1`],
      earlier_concept_ids: [],
      item_count: 10,
      estimated_minutes: 8,
    },
    checkpoint: null,
    estimated_minutes: 20,
    ...overrides,
  }
}

export function section(id: string, overrides: Partial<SectionNode> = {}): SectionNode {
  return {
    id,
    title: `Sección ${id}`,
    modules: [module(`${id}M1`)],
    ...overrides,
  }
}

export function buildDraft(overrides: Partial<PathDraft> = {}): PathDraft {
  return {
    version: 1,
    kind: 'draft',
    title: 'Curso de prueba',
    language: 'es-AR',
    target_language: null,
    level: 'beginner',
    goal: 'Aprender la materia',
    target_date: null,
    sources: [{ source_id: 'src-1', title: 'Fuente 1', primary: true }],
    sections: [section('S01'), section('S02')],
    final_exam: {
      id: 'FINAL',
      kind: 'final_exam',
      blueprint: { topics: [{ module_id: 'S01M1', weight: 1 }], item_count: 20 },
      estimated_minutes: 60,
    },
    misconceptions: [],
    excluded: [],
    stats: {
      sections: 2,
      modules: 2,
      lessons: 4,
      checkpoints: 0,
      concepts: 10,
      minutes: 56,
      weeks_estimate: 4,
    },
    warnings: [],
    known_node_ids: [],
    qa_mode: 'full',
    ...overrides,
  }
}
