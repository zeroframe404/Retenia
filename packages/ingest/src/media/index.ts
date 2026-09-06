/**
 * The audio and video pipeline (sub-phase 6.4).
 *
 * A separate entry point (`@retenia/ingest/media`) rather than part of the package barrel:
 * everything here reaches for the sidecar manager, and the main process — which imports the
 * barrel for its job registry — should not evaluate a process spawner at startup.
 */

export {
  byTime,
  FUSION_BUCKET_SECONDS,
  fuseSaidAndShown,
  type GlossaryCorrection,
  identityGlossary,
  MAX_FRAME_TEXT_CHARS,
  type ShownFrame,
  transcriptBlocks,
} from './blocks'
export {
  buildCourseParts,
  type CourseFile,
  type CoursePart,
  courseTitle,
  naturalCompare,
} from './course'
export {
  DUPLICATE_DISTANCE,
  dedupeFrames,
  dhash,
  type HashedFrame,
  hammingDistance,
  splitFrames,
} from './dhash'
export {
  ABSOLUTE_MAX_FRAMES,
  MAX_FRAMES_PER_HOUR,
  MIN_FRAMES_PER_HOUR,
  maximumKeep,
  minimumKeep,
  type SelectionResult,
  sceneDetectionFailed,
  selectKeyframes,
} from './keyframes'
export {
  MediaCancelledError,
  type MediaParseDeps,
  type MediaParseInput,
  type MediaPartInput,
  type MediaToolchain,
  parseMedia,
} from './parse-media'
export {
  CUDA_WHISPER_MODEL_ID,
  DEFAULT_WHISPER_MODEL_ID,
  ensureWeight,
  findWeight,
  isWeightInstalled,
  requireWeight,
  SILERO_VAD,
  type WeightKind,
  type WeightSpec,
  WHISPER_MODELS,
  weightPath,
  weightUrl,
} from './weights'
