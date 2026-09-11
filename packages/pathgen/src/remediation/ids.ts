/**
 * The derived id of a remediation lesson (`docs/spec/04-path-generation.md` §8 `Lesson.v1`:
 * `id ("L07" | "L07.r1")`; §11: "a derived id `Lxx.rN`"; `docs/spec/01-decisions.md` §3:
 * "without renumbering").
 *
 * `N` counts every detour ever anchored to that lesson — dismissed and failed ones included —
 * so an id is never handed out twice, and a learner who dismissed `L07.r1` gets `L07.r2`, not a
 * second, different `L07.r1`.
 */

const CORE_ID = /^L\d+$/
const REMEDIATION_ID = /^(L\d+)\.r([1-9]\d*)$/

export function isCoreLessonSpecId(specId: string): boolean {
  return CORE_ID.test(specId)
}

export function parseRemediationSpecId(
  specId: string,
): { readonly anchor: string; readonly n: number } | null {
  const match = REMEDIATION_ID.exec(specId)
  if (match === null) return null
  return { anchor: match[1] as string, n: Number(match[2]) }
}

export function isRemediationSpecId(specId: string): boolean {
  return REMEDIATION_ID.test(specId)
}

/** `L07` + the ids already taken → the next `L07.rN`. */
export function remediationSpecId(anchorSpecId: string, taken: Iterable<string>): string {
  if (!isCoreLessonSpecId(anchorSpecId)) {
    throw new RangeError(`a remediation hangs off a core lesson, not "${anchorSpecId}"`)
  }
  let highest = 0
  for (const specId of taken) {
    const parsed = parseRemediationSpecId(specId)
    if (parsed !== null && parsed.anchor === anchorSpecId && parsed.n > highest) highest = parsed.n
  }
  return `${anchorSpecId}.r${highest + 1}`
}
