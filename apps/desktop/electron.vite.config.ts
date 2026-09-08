import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      // Externalization is on by default (`build.externalizeDeps ?? true`), which is what
      // native modules like better-sqlite3 need: `sqlite-vec` also resolves a loadable
      // extension from its own package directory, and neither survives being bundled.
      //
      // The workspace packages are the other way round: every `@retenia/*` package ships
      // TypeScript source with no build step (their `exports` point straight at
      // `./src/index.ts`), so Node could not `require` them at runtime and they have to be
      // bundled. `zod` comes along with the contract.
      //
      // This list is therefore not optional polish: **any** `@retenia/*` package imported
      // from `src/main/**` must appear here. Leave one out and the emitted
      // `out/main/index.js` keeps a bare import that resolves to raw TypeScript; the main
      // process throws on startup, no window ever opens, and the only thing that notices is
      // the e2e job, where all of Playwright fails at once with "timeout ... while setting
      // up electronApp". `externalize-main-deps.test.ts` keeps the list honest.
      externalizeDeps: {
        exclude: [
          '@retenia/ipc-contract',
          '@retenia/core',
          '@retenia/db',
          '@retenia/activity-schema',
          '@retenia/ingest',
          '@retenia/ai',
          'zod',
        ],
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The job worker, forked by `utilityProcess` (docs/spec/07-architecture.md §7).
          // Emitted alongside `index.js` so `getJobWorkerPath()` can resolve it from
          // `__dirname` in a dev run, a packaged asar and under Playwright alike.
          'job-worker': resolve(__dirname, 'src/worker/index.ts'),
          // The warm model host (sub-phase 6.3), forked the same way and resolved from
          // `__dirname` by `getEmbeddingHostPath()`.
          'embedding-host': resolve(__dirname, 'src/worker/embedding-host.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // A sandboxed preload has no real `require` beyond `electron` and a handful of
      // builtins, so *nothing* may be left external. Sandboxed preloads must also be
      // CommonJS; electron-vite names an ESM preload `.mjs`, which would fail to parse.
      externalizeDeps: false,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    build: {
      // Never inline a font as a `data:` URL.
      //
      // Vite inlines any asset under `assetsInlineLimit` (4 KB by default), and KaTeX ships one
      // font small enough to qualify — `KaTeX_Size3`, the one that draws oversized delimiters.
      // The renderer's policy is `font-src 'self'` (`src/main/security/csp.ts`), so that single
      // inlined face was blocked in the packaged app while its ten siblings, emitted as files
      // under `app://`, loaded fine: large brackets and integrals silently fell back to a system
      // font. Fonts are therefore always emitted as files; everything else keeps Vite's default.
      assetsInlineLimit: (filePath: string) =>
        /\.(?:woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
    },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
      }),
      react(),
      tailwindcss(),
    ],
  },
})
