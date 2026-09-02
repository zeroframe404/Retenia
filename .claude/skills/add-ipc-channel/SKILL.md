---
name: add-ipc-channel
description: How to declare a new main↔renderer IPC channel in packages/ipc-contract, implement its handler in the Electron main process, expose it via preload, and consume it from the renderer with TanStack Query. Use when asked to add or wire up a new IPC channel.
---

# Add an IPC channel

All main↔renderer communication goes through `packages/ipc-contract` with zod-validated schemas — never raw `ipcMain.handle`/`ipcRenderer.invoke` payloads.

## Naming rule

Channels are named `domain.action`, e.g. `cards.review`, `notes.create`, `settings.updateProvider`. Use camelCase for the action segment, lowercase for the domain segment.

## Steps

1. **Declare the channel in `packages/ipc-contract`.**
   Define a zod input schema and output schema for the channel, and register it in the contract's channel map so both main and renderer share the same types.

   ```ts
   // packages/ipc-contract/src/channels/cards.ts
   import { z } from 'zod'

   export const cardsReview = {
     channel: 'cards.review' as const,
     input: z.object({
       cardId: z.string().uuid(),
       rating: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
     }),
     output: z.object({
       cardId: z.string().uuid(),
       due: z.string().datetime(),
     }),
   }
   ```

2. **Implement the handler in `apps/desktop/src/main/ipc/`.**
   Register it with `ipcMain.handle(cardsReview.channel, async (_event, rawInput) => { ... })`, parsing `rawInput` with `cardsReview.input.parse(...)` before touching domain logic, and validating the return value against `cardsReview.output` before sending it back.

3. **Expose it in preload.**
   The preload script's generated `api` object gets a matching method (e.g. `api.cards.review(input)`) that calls `ipcRenderer.invoke(cardsReview.channel, input)`. Never expose `ipcRenderer` itself to the renderer — only the specific typed methods via `contextBridge.exposeInMainWorld`.

4. **Consume it in the renderer with TanStack Query.**
   Wrap the call in a `useMutation` (for actions) or `useQuery` (for reads) hook, keyed by the channel name, calling `window.api.<domain>.<action>(...)`.

## Reminders

- Both input and output are validated at the boundary — never trust the other side of the IPC bridge implicitly.
- `better-sqlite3` and any Node-only code stay in the main process handler, never in preload or renderer.
- Add/update tests for the handler under `apps/desktop` and for the contract schema under `packages/ipc-contract`.
