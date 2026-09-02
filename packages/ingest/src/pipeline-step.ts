/**
 * Port a single ingestion pipeline step implements (extractors, chunking, embeddings —
 * real steps land in sub-phase 6.x). Steps are pure transforms so the job queue can
 * retry/resume them.
 */
export interface PipelineStep<Input, Output> {
  readonly name: string
  run(input: Input): Promise<Output>
}

/** Runs a chain of `PipelineStep`s, feeding each one's output into the next. */
export async function runPipeline<T>(
  input: T,
  steps: ReadonlyArray<PipelineStep<T, T>>,
): Promise<T> {
  let value = input
  for (const step of steps) {
    value = await step.run(value)
  }
  return value
}
