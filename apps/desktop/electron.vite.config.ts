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
      // The workspace packages are the other way round: `@retenia/ipc-contract`,
      // `@retenia/core` and `@retenia/db` all ship TypeScript source with no build step, so
      // Node could not `require` them at runtime and they have to be bundled. `zod` comes
      // along with the contract.
      externalizeDeps: {
        exclude: ['@retenia/ipc-contract', '@retenia/core', '@retenia/db', 'zod'],
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The job worker, forked by `utilityProcess` (docs/spec/07-architecture.md §7).
          // Emitted alongside `index.js` so `getJobWorkerPath()` can resolve it from
          // `__dirname` in a dev run, a packaged asar and under Playwright alike.
          'job-worker': resolve(__dirname, 'src/worker/index.ts'),
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
