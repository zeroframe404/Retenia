---
name: add-ipc-channel
description: How to declare a new main↔renderer IPC channel in packages/ipc-contract, implement its handler in the Electron main process, expose it via preload, and consume it from the renderer with TanStack Query. Use when asked to add or wire up a new IPC channel.
---

# Add an IPC channel

All main↔renderer communication goes through `packages/ipc-contract` with zod-validated
schemas — never raw `ipcMain.handle`/`ipcRenderer.invoke` payloads. The preload surface and
the main-process registration are both **generated from the contract**, so declaring the
channel is most of the work: there is no separate place to list it.

## Naming rule

Channels are named `domain.action`, e.g. `cards.review`, `notes.create`,
`settings.updateProvider`. Lowercase domain, camelCase action. `events` is reserved as a
domain name — it would collide with `api.events`.

## Steps

1. **Declare the channel in `packages/ipc-contract`.**
   One file per domain under `src/channels/`, wrapped in `defineContract` so the channel
   names stay literal types.

   ```ts
   // packages/ipc-contract/src/channels/cards.ts
   import { z } from 'zod'
   import { defineContract } from '../define'

   export const cardsChannels = defineContract({
     'cards.review': {
       input: z.object({
         cardId: z.uuid(),
         rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
       }),
       output: z.object({
         cardId: z.uuid(),
         due: z.iso.datetime(),
       }),
     },
   })
   ```

   Then merge it into the contract in `src/index.ts`:

   ```ts
   export const contract = {
     ...appChannels,
     ...cardsChannels,
   }
   ```

2. **Implement the handler in `apps/desktop/src/main/ipc/handlers.ts`.**
   `Handlers<Contract>` requires exactly one entry per channel, so TypeScript tells you
   what is missing. Handlers take validated input and return the plain output value —
   `registerHandlers` owns the sender check, the zod validation of input *and* output, the
   error trapping and the response envelope. Do not call `ipcMain.handle` yourself.

   ```ts
   'cards.review': async ({ cardId, rating }) => reviewCard(cardId, rating),
   ```

   Throw from a handler to signal failure; the thrown message (never the stack) reaches the
   renderer as `{ ok: false, error: { code: 'HANDLER_ERROR', message } }`.

3. **Preload needs no change.**
   `apps/desktop/src/preload/build-api.ts` walks the contract and generates
   `window.api.cards.review(input)`. A channel that is not in the contract has no function
   to call. Never expose `ipcRenderer` itself.

4. **Consume it in the renderer.**
   Use the hooks in `apps/desktop/src/renderer/src/ipc/hooks.ts`, which wrap TanStack Query
   and unwrap the envelope (a failure becomes a thrown `IpcError` carrying `error.code`):

   ```ts
   const review = useIpcMutation('cards.review')   // writes
   const due = useIpcQuery('cards.listDue', { limit: 20 })   // reads
   ```

## Push events

Events go in `src/events/`, declared with `defineEvents` and merged into `events` in
`src/index.ts`. Main sends them with `emitEvent(webContents, name, payload)` (which
validates first); the renderer subscribes with `useIpcEvent(name, listener)`.

## Reminders

- Both input and output are validated at the boundary — never trust the other side of the
  IPC bridge implicitly.
- `better-sqlite3` and any Node-only code stay in the main process handler, never in
  preload or renderer.
- Add tests for the schema under `packages/ipc-contract` and for the handler under
  `apps/desktop`.
