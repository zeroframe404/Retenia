import { describe, expect, it } from 'vitest'
import type { TheoryBlock } from '../../schemas/lesson'
import type { ClaimVerdictEntry, FaithfulnessOutput } from '../../schemas/qa'
import { extractClaims } from '../claims'
import { applyFaithfulness, FAITHFULNESS_PASS, FAITHFULNESS_REGENERATE } from './faithfulness'

function block(type: TheoryBlock['type'], content: string, citations: string[] = []): TheoryBlock {
  return { type, content, citations, diagram: null, misconception_id: null }
}

const blocks = [
  block(
    'explanation',
    'La memoria de trabajo retiene unos cuatro elementos a la vez. [cite:B01] El bucle fonológico repite la información verbal. [cite:B02]',
    ['B01', 'B02'],
  ),
  block('summary', '- Cuatro elementos\n- Un bucle', ['B01']),
]

function verdict(
  id: string,
  kind: ClaimVerdictEntry['verdict'],
  extra: Partial<ClaimVerdictEntry> = {},
): ClaimVerdictEntry {
  return {
    id,
    verdict: kind,
    citation_id: 'B01',
    sources_differ: false,
    differing_citation_ids: [],
    note: kind === 'supported' ? '' : 'la fuente dice otra cosa',
    ...extra,
  }
}

function run(output: FaithfulnessOutput, mode: 'full' | 'light' = 'full') {
  return applyFaithfulness({
    lessonSpecId: 'L01',
    blocks,
    claims: extractClaims(blocks),
    output,
    mode,
  })
}

describe('applyFaithfulness() — §5 gate 3', () => {
  it('scores supported ÷ evaluated and passes at ≥ 0.9', () => {
    const result = run({ claims: [verdict('c01', 'supported'), verdict('c02', 'supported')] })
    expect(result.faithfulness).toBe(1)
    expect(result.outcome).toBe('pass')
    expect(result.blocks).toEqual(blocks)
    expect(FAITHFULNESS_PASS).toBe(0.9)
    expect(FAITHFULNESS_REGENERATE).toBe(0.7)
  })

  it('asks for a regeneration under 0.7 and strips the markers of the claim it could not place', () => {
    const result = run({ claims: [verdict('c01', 'supported'), verdict('c02', 'unsupported')] })
    expect(result.faithfulness).toBe(0.5)
    expect(result.outcome).toBe('regenerate')
    expect(result.blocks[0]?.content).toBe(
      'La memoria de trabajo retiene unos cuatro elementos a la vez. [cite:B01] El bucle fonológico repite la información verbal.',
    )
    expect(result.blocks[0]?.citations).toEqual(['B01'])
    expect(result.findings.map((finding) => finding.kind)).toEqual(['claim_unsupported'])
    expect(result.findings[0]?.citation_ids).toEqual(['B02'])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['lesson_below_threshold'])
    // A regeneration replaces the text: no edits are listed for an editor that will not run.
    expect(result.edits).toEqual([])
  })

  it('reports a contradiction as its own kind', () => {
    const result = run({ claims: [verdict('c01', 'contradicts'), verdict('c02', 'supported')] })
    expect(result.findings.map((finding) => finding.kind)).toEqual(['claim_contradicts'])
  })

  it('flags "las fuentes difieren" with both citations and keeps the claim cited', () => {
    const result = run({
      claims: [
        verdict('c01', 'supported', {
          sources_differ: true,
          differing_citation_ids: ['B01', 'B03'],
        }),
        verdict('c02', 'supported'),
      ],
    })
    expect(result.faithfulness).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'sources_differ', citation_ids: ['B01', 'B03'] }),
    ])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['sources_differ'])
    expect(result.blocks[0]?.citations).toEqual(['B01', 'B02'])
  })

  it('sends the 0.7–0.9 band to the editor in full mode, with one edit per struck claim', () => {
    const many = [
      block(
        'explanation',
        [
          'Primera afirmación larga y verificable. [cite:B01]',
          'Segunda afirmación larga y verificable. [cite:B01]',
          'Tercera afirmación larga y verificable. [cite:B01]',
          'Cuarta afirmación larga y verificable. [cite:B01]',
          'Quinta afirmación larga y verificable. [cite:B01]',
        ].join(' '),
        ['B01'],
      ),
    ]
    const claims = extractClaims(many)
    const output = {
      claims: claims.map((claim, index) =>
        verdict(claim.id, index === 0 ? 'unsupported' : 'supported'),
      ),
    }
    const full = applyFaithfulness({
      lessonSpecId: 'L01',
      blocks: many,
      claims,
      output,
      mode: 'full',
    })
    expect(full.faithfulness).toBe(0.8)
    expect(full.outcome).toBe('fix')
    expect(full.edits).toHaveLength(1)
    expect(full.edits[0]).toMatchObject({ blockIndex: 0, kind: 'replace', source: 'faithfulness' })
    expect(full.warnings.map((entry) => entry.code)).toEqual(['faithfulness_needs_review'])

    // Light mode has no editor: the band passes the gate and the lesson is flagged instead.
    const light = applyFaithfulness({
      lessonSpecId: 'L01',
      blocks: many,
      claims,
      output,
      mode: 'light',
    })
    expect(light.outcome).toBe('pass')
    expect(light.edits).toEqual([])
    expect(light.warnings.map((entry) => entry.code)).toEqual(['faithfulness_needs_review'])
  })

  it('withdraws a sibling id only when every sentence that leaned on it was struck', () => {
    const leaning = [
      block(
        'explanation',
        'Primera afirmación que se apoya en la lista del bloque. Segunda afirmación que también se apoya en ella.',
        ['B01'],
      ),
    ]
    const claims = extractClaims(leaning)
    expect(claims.every((claim) => !claim.ownCitations)).toBe(true)
    const half = applyFaithfulness({
      lessonSpecId: 'L01',
      blocks: leaning,
      claims,
      output: { claims: [verdict('c01', 'unsupported'), verdict('c02', 'supported')] },
      mode: 'full',
    })
    expect(half.blocks[0]?.citations).toEqual(['B01'])
    const none = applyFaithfulness({
      lessonSpecId: 'L01',
      blocks: leaning,
      claims,
      output: { claims: [verdict('c01', 'unsupported'), verdict('c02', 'unsupported')] },
      mode: 'full',
    })
    expect(none.blocks[0]?.type).toBe('general_knowledge')
    expect(none.blocks[0]?.citations).toEqual([])
  })

  it('counts a claim the verifier skipped against the score, and leaves its markers alone', () => {
    const result = run({ claims: [verdict('c01', 'supported')] })
    expect(result.answered).toBe(1)
    expect(result.evaluated).toBe(2)
    expect(result.faithfulness).toBe(0.5)
    expect(result.outcome).toBe('regenerate')
    expect(result.blocks).toEqual(blocks)
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'claim_unsupported',
        detail: 'the verifier returned no verdict for this claim',
      }),
    ])
  })

  it('is skipped, with qa_failed, when the verifier answered none of the claims', () => {
    const result = run({ claims: [] })
    expect(result.answered).toBe(0)
    expect(result.faithfulness).toBeNull()
    expect(result.outcome).toBe('skipped')
    expect(result.blocks).toEqual(blocks)
    expect(result.warnings.map((entry) => entry.code)).toEqual(['qa_failed'])
  })

  it('is skipped, quietly, when there was nothing to evaluate', () => {
    const result = applyFaithfulness({
      lessonSpecId: 'L01',
      blocks: [],
      claims: [],
      output: { claims: [] },
      mode: 'full',
    })
    expect(result.faithfulness).toBeNull()
    expect(result.outcome).toBe('skipped')
    expect(result.warnings).toEqual([])
  })
})
