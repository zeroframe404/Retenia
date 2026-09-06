export type { DeviceEnvironment, EmbeddingDevice } from './device'
export {
  EMBEDDING_DEVICES,
  isEmbeddingDevice,
  nodeDeviceEnvironment,
  resolveDevices,
} from './device'
export type { OllamaEmbeddingOptions } from './ollama'
export {
  createOllamaEmbedding,
  DEFAULT_OLLAMA_BATCH_SIZE,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  embeddingsUrl,
  OllamaUnavailableError,
  probeOllamaEmbedding,
} from './ollama'
export {
  assertIndexable,
  l2Normalize,
  randomProject,
  reduceToIndexWidth,
  truncateMatryoshka,
} from './reduce'
export type {
  FeatureExtractionPipeline,
  LocalEmbeddingProvider,
  PipelineTensor,
  TransformersEmbeddingOptions,
  TransformersModule,
} from './transformers'
export { createTransformersEmbedding, defaultBatchSize } from './transformers'
