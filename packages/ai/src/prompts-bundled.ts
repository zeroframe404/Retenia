import type { PromptFileReader } from './prompts/registry'

/**
 * The prompt files, inlined into the bundle rather than read from disk.
 *
 * `PROMPTS_ROOT` is resolved from `import.meta.url`, which is correct when this package runs
 * from source (vitest, `tsx`) and wrong the moment a bundler inlines it somewhere else — and
 * `apps/desktop` must bundle `@retenia/ai`, because the package ships TypeScript with no
 * build step and Node cannot `require` a `.ts` file. From `out/main/index.js` the same
 * arithmetic lands on `apps/desktop/prompts`, which does not exist, so the Electron main
 * process crashed on startup the moment anything loaded a prompt.
 *
 * So main reads the prompts through this entry point instead, and they travel inside
 * `out/main/index.js` with no path arithmetic, no `extraResources`, and one code path shared
 * by `electron-vite dev`, a packaged asar and Playwright. `@retenia/db`'s
 * `migrations-bundled` solves the identical problem the identical way, for the same reason.
 *
 * A **separate entry point** on purpose: `import.meta.glob` is a bundler feature, and
 * `@retenia/ai/prompts` has to keep working under plain Node for this package's own scripts.
 */

/**
 * `import.meta.glob` is provided by the bundler (Vite, and therefore Vitest and
 * electron-vite), not by the runtime. Typed here rather than by pulling in `vite/client`:
 * this package does not depend on Vite — it only ever *runs* under one for this entry point.
 */
interface BundlerImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>
}

const sources = (import.meta as unknown as BundlerImportMeta).glob('../prompts/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** `<id>/<version>.md` → the file's text. */
export const BUNDLED_PROMPT_FILES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(sources).map(([path, text]) => [
      path.slice(path.indexOf('/prompts/') + '/prompts/'.length),
      text,
    ]),
  ),
)

export class MissingBundledPromptError extends Error {
  override readonly name = 'MissingBundledPromptError'
  constructor(file: string) {
    super(
      `prompts/${file} is not in the bundle — the glob in prompts-bundled.ts did not pick it up`,
    )
  }
}

/** Pass to `loadPrompt(id, version, bundledPromptReader)`. */
export const bundledPromptReader: PromptFileReader = (file) => {
  const text = BUNDLED_PROMPT_FILES[file]
  if (text === undefined) throw new MissingBundledPromptError(file)
  return text
}
