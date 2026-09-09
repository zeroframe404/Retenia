/**
 * A promptfoo custom provider that routes through the real `packages/ai` client — the same
 * role resolution, pricing table and cost math the app itself uses — instead of promptfoo's
 * native `anthropic:`/`google:` providers. `config.role` picks `smart` or `cheap`
 * (`docs/spec/06-ai-providers.md` §6's two roles); everything else (fallback order, which
 * model answers) comes from `DEFAULT_ROLES`, the same registry `apps/desktop` boots with.
 *
 * Keys are read from `process.env` (`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) — evals never
 * touch the app's encrypted secret store, which lives behind Electron's `safeStorage` and
 * has no meaning outside a running app.
 *
 * The spend cap lives here, not in `run-evals.mjs`: promptfoo runs every test case inside
 * this one Node process (local file providers are not forked), so a module-level counter is
 * shared across every call in the run and can refuse the *next* call before it dials out —
 * a real-time cap, not a post-hoc one. `run-evals.mjs` still reads the ledger file this
 * writes after each call, because it runs `promptfoo` as a child process and has no other
 * way to see this module's state.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAiClient, DEFAULT_PROFILES, DEFAULT_ROLES, realTimers } from '@retenia/ai'
import { createSdkInvoker } from '@retenia/ai/providers'

const LEDGER_PATH = fileURLToPath(new URL('../.spend-ledger.json', import.meta.url))
const MAX_SPEND_USD = Number(process.env.MAX_EVAL_SPEND_USD ?? '2.00')

const SECRET_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
}

let spentUsd = 0

function writeLedger() {
  try {
    writeFileSync(LEDGER_PATH, JSON.stringify({ spentUsd, capUsd: MAX_SPEND_USD }, null, 2))
  } catch {
    // A failure to write the ledger must not fail the eval itself — `run-evals.mjs`'s report
    // just says "unknown" for the total, which is honest about what it could not observe.
  }
}

const ai = createAiClient({
  invoker: createSdkInvoker(),
  registry: async () => ({ profiles: DEFAULT_PROFILES, roles: DEFAULT_ROLES }),
  getSecret: async (name) => process.env[SECRET_ENV[name]],
  recordCall: async () => {},
  spentSinceUsd: async () => 0,
  monthlyBudgetUsd: async () => 0,
  clock: { now: () => new Date() },
  timers: realTimers,
  logger: { warn: () => {}, error: () => {} },
})

export default class RoleProvider {
  constructor(options) {
    this.role = options?.config?.role ?? 'cheap'
  }

  id() {
    return `retenia-role:${this.role}`
  }

  async callApi(prompt) {
    // Written on the very first call too, even before anything is spent: a report that
    // finds no ledger at all cannot tell "nothing was spent" from "the provider never ran",
    // and the two need different follow-up.
    writeLedger()

    if (spentUsd >= MAX_SPEND_USD) {
      return {
        output: '',
        error: `spend cap reached (USD ${spentUsd.toFixed(2)} of ${MAX_SPEND_USD.toFixed(2)}); no call made`,
        cost: 0,
      }
    }

    try {
      const result = await ai.textGenerator({ role: this.role, purpose: 'eval' })({
        prompt,
        temperature: 0,
      })
      const cost = result.usage?.usd ?? 0
      spentUsd += cost
      writeLedger()
      return {
        output: result.text,
        cost,
        tokenUsage: {
          total: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
          prompt: result.usage?.inputTokens ?? 0,
          completion: result.usage?.outputTokens ?? 0,
        },
      }
    } catch (error) {
      return { output: '', error: error instanceof Error ? error.message : String(error), cost: 0 }
    }
  }
}
