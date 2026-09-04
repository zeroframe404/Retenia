/** A grader this package does not implement yet (a placeholder family, CAS math, …). */
export class GraderUnsupportedError extends Error {
  override readonly name = 'GraderUnsupportedError'
  constructor(readonly what: string) {
    super(`No pure grader for ${what}`)
  }
}
