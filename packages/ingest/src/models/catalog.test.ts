import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_RERANKER_MODEL_ID,
  findModel,
  graphFile,
  INDEX_DIMENSIONS,
  listModels,
  modelDirectory,
  requireModel,
} from './catalog'

describe('the model manifest', () => {
  it('is not empty and every id is unique', () => {
    const models = listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length)
  })

  it('pins a commit rather than a branch, so the hashes below stay true', () => {
    for (const model of listModels()) {
      expect(model.revision, model.id).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('gives every file a lower-case hex sha256 and a positive size', () => {
    for (const model of listModels()) {
      expect(model.files.length, model.id).toBeGreaterThan(0)
      for (const file of model.files) {
        expect(file.sha256, `${model.id}/${file.path}`).toMatch(/^[0-9a-f]{64}$/)
        expect(file.bytes, `${model.id}/${file.path}`).toBeGreaterThan(0)
      }
      expect(model.bytes).toBe(model.files.reduce((sum, file) => sum + file.bytes, 0))
    }
  })

  it('ships the graph and the tokenizer of every model — a config alone cannot run', () => {
    for (const model of listModels()) {
      const paths = model.files.map((file) => file.path)
      expect(paths, model.id).toContain('config.json')
      expect(paths, model.id).toContain('tokenizer.json')
      expect(paths, model.id).toContain(graphFile(model))
    }
  })

  it('names a dtype transformers.js actually understands', () => {
    // `dtype` and the file name are different strings — `q8` loads `model_quantized.onnx` —
    // and an unrecognised dtype does not throw in the library: it silently falls back to
    // `fp32` and looks for `onnx/model.onnx`, which none of these repositories ship at the
    // size we want. That failure would surface on a user's machine after a 300 MB download.
    for (const model of listModels()) {
      expect(graphFile(model), model.id).toBe('onnx/model_quantized.onnx')
      expect(model.dtype, model.id).toBe('q8')
    }
    expect(() => graphFile({ id: 'x', dtype: 'quantized' })).toThrow(
      /unknown transformers.js dtype/,
    )
  })
})

describe('the catalog', () => {
  it('stores every embedding model at the width of the index', () => {
    for (const model of listModels('embedding')) {
      expect(model.dims, model.id).toBe(INDEX_DIMENSIONS)
    }
  })

  it('only claims "no reduction" when the model really is that wide', () => {
    for (const model of listModels()) {
      if (model.reduction === 'none') expect(model.nativeDims, model.id).toBe(model.dims)
      else expect(model.nativeDims, model.id).toBeGreaterThan(model.dims)
    }
  })

  it('only truncates models trained for it', () => {
    // Matryoshka truncation is valid *because of how the model was trained*; applying it to
    // anything else quietly degrades retrieval. bge-m3 is the standing example: 1024 dims and
    // no MRL, so it must be projected, never sliced.
    const bge = requireModel('bge-m3')
    expect(bge.reduction).toBe('random-projection')
  })

  it('names a space that carries the stored width, so two reductions never mix', () => {
    for (const model of listModels('embedding')) {
      expect(model.spaceId, model.id).toBe(`${model.id}@${model.dims}`)
    }
    expect(new Set(listModels().map((model) => model.spaceId)).size).toBe(listModels().length)
  })

  it('resolves both defaults, and to the right kind', () => {
    expect(requireModel(DEFAULT_EMBEDDING_MODEL_ID, 'embedding').kind).toBe('embedding')
    expect(requireModel(DEFAULT_RERANKER_MODEL_ID, 'reranker').kind).toBe('reranker')
  })

  it('refuses a model of the wrong kind rather than loading it into the wrong port', () => {
    expect(() => requireModel(DEFAULT_RERANKER_MODEL_ID, 'embedding')).toThrow(/reranker model/)
    expect(() => requireModel('no-such-model')).toThrow(/No model/)
    expect(findModel('no-such-model')).toBeUndefined()
  })

  it('lays a model out under its repository path, which is what transformers.js resolves', () => {
    const gemma = requireModel(DEFAULT_EMBEDDING_MODEL_ID)
    expect(modelDirectory(gemma)).toBe(gemma.repo)
    expect(gemma.repo).toContain('/')
  })

  it('carries EmbeddingGemma’s asymmetric retrieval prompts', () => {
    // Without these the query lands in a different region of the space from the passages it
    // is supposed to match; the model card prescribes both strings verbatim.
    const gemma = requireModel(DEFAULT_EMBEDDING_MODEL_ID)
    expect(gemma.queryPrefix).toBe('task: search result | query: ')
    expect(gemma.documentPrefix).toBe('title: none | text: ')
  })
})
