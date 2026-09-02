import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      // Externalization is on by default (`build.externalizeDeps ?? true`), which is what
      // native modules like better-sqlite3 will need later. `@retenia/ipc-contract` is
      // published as TypeScript source with no build step, and zod comes along with it, so
      // both have to be bundled instead.
      externalizeDeps: { exclude: ['@retenia/ipc-contract', 'zod'] },
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
