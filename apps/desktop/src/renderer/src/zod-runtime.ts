import { config } from 'zod'

/**
 * Turns zod's JIT off for the renderer, before any schema is built.
 *
 * Zod compiles a fast path for an object schema with `new Function`, and decides whether it can
 * at *construction* time — it probes once by building an empty function inside a `try`. The
 * renderer's policy has no `'unsafe-eval'` (`src/main/security/csp.ts`), so the probe can only
 * ever fail here; zod falls back correctly, but Chromium still reports the blocked construction
 * as a `securitypolicyviolation`. A `script-src`/`eval` report is the loudest signal this app
 * has that something started executing content, and a permanent false positive in it is a
 * signal nobody will read. Telling zod up front that there is no JIT removes the report without
 * changing a single validation result. The main process has no CSP and keeps its fast path.
 *
 * This lives in its own module, loaded from `index.html` as the first module script, because
 * "before any schema is built" is a real constraint and not one an import statement can express:
 * every `import` in `main.tsx` — `@retenia/ipc-contract` among them — is evaluated before the
 * first line of its body, and those modules build their schemas as they load.
 */
config({ jitless: true })
