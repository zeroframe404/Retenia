---
name: add-activity-type
description: How to add a new learning activity type — registry row, family payload schema, validation rules, fixtures, grader, renderer, Storybook story, registry entry and generation prompt stub — across packages/activity-schema, packages/activity-graders and packages/activities. Use when asked to add, implement, or scaffold a new activity type.
---

# Add an activity type

An activity type is spread over three packages (`docs/spec/03-activities.md` §7–§9): its data
contract and rules live in `packages/activity-schema`, its pure grader in
`packages/activity-graders`, and its renderer, story and registry entry in
`packages/activities`. Follow this checklist in order — each step is verifiable on its own, and
the order is the one that keeps the repo green between steps.

## Checklist

1. **Register the type in the master table** — add or edit its row in
   `packages/activity-schema/src/registry.ts` (`ROWS`, in the order of the master table of
   `docs/spec/03-activities.md` §4). The row carries `type` (snake_case id), `family`, `category`,
   `grader` (`det | fuzzy | ai | self | speech | code | cas | none`), `ratingStrategy` (core's
   `RatingRule`: `binary | partial | fuzzy | ordering | matching | objective | ai | speech | self |
   none`), `complexity`, `phase`, `generation` and `media`. The registry test asserts the counts
   (98 types, 21 MVP, 89 review-eligible), so update it when a row is added. Document any second
   admissible rating strategy or grading method in `REVIEW_ALTERNATES` / `GRADING_ALTERNATES`.

2. **Family payload schema** — if the family is new or still a placeholder, replace its entry in
   `packages/activity-schema/src/families/` with a zod object that starts with
   `family: z.literal('<family>')`, and add the family's response schema in
   `src/responses.ts`. Express ranges with `.min()/.max()/.regex()`: the JSON Schema export
   demotes them to descriptions for Claude strict mode, and `pnpm run schema:check` verifies
   the result.

3. **Per-type rules** — add the invariants zod cannot express to
   `packages/activity-schema/src/validate/<family>.ts` (one `Issue` code each, listed in
   `validate/types.ts`), following §11: unique ids, every gap answerable, orders are
   permutations, the answer is not in the stem.

4. **Fixtures** — add `packages/activity-schema/fixtures/<id>/valid-1..3.json` and
   `invalid-1..2.json`. A valid fixture is `{ activity, answers: [{ name, response, meta?,
   expect: { score, correct, perItem?, signals?, engine? } }] }` with hand-computed scores;
   an invalid one is `{ activity, expect: { layer: 'schema' | 'rules', codes } }`.
   `src/fixtures.test.ts` and the graders' `families/fixtures.test.ts` pick them up
   automatically — and so do the activity catalogue story and its axe suite (step 7), because
   both read the fixture directory rather than a hand-kept list.

5. **Grader** — implement or extend `packages/activity-graders/src/families/<family>.ts`
   (pure: no Node, Electron or provider imports), returning `GradeResult` with `rating: null`
   (`rateResult` fills it through core's `toRating`). Keep branch coverage at 100 %:
   `pnpm --filter @retenia/activity-graders test:coverage`.

6. **Renderer** — a new *type* of an existing family usually needs no renderer at all: `type`
   decides the renderer and `family` decides the data (§7), and `packages/activities/src/families/`
   holds one renderer per family, shared by every type in it. Extend that renderer if the type
   needs a variant (`payload.mode`, `payload.presentation`), and add a whole new file only for a
   genuinely new family — in which case also register it in
   `packages/activities/src/registry/renderers.ts`'s `FAMILY_MODULES`, so it stays one lazy chunk
   per family.

   A renderer takes **no props**: it reads everything from `useFamilyActivity('<family>')`. Two
   rules are not optional:
   - **Every drag-and-drop needs a keyboard alternative** (§9). Use `DragLayer` / `DraggableItem` /
     `DropZone` from `packages/activities/src/components/drag-layer.tsx` — they give Tab-and-Enter
     select-then-place and arrow-key navigation for free. Never make a pointer the only way in.
   - **`data-testid="renderer-<family>"`** on the root element: the catalogue suite waits on it to
     know the lazy chunk actually mounted.

7. **Registry entry** — add `packages/activities/src/registry/types/<id>.ts`, one file per type,
   and import it from `registry/types/index.ts` in master-table order. Use `defineActivityType`,
   which reads `family`, the family renderer, the family grader, `validateActivity` and the row's
   rating strategy from step 1 — so the file states only what the table does not know:

   ```ts
   export default defineActivityType({
     type: '<id>',
     generator: {
       promptTemplate: promptStub({ type: '<id>', focus: '…', rules: ['…'] }),
       needsMedia: false,
       itemsPerCall: 8,
       sourceMode: 'chunk',
     },
     review: { expectedSeconds: 20, progression: 'recognition' },
     // capabilities defaults to { offline: true, needsMic: false, needsSandbox: false }
   })
   ```

   `promptStub` is the **generation prompt stub** (§9's `generator.promptTemplate`): a one-line
   `focus` plus the fixed per-type rules of §11 — option counts, plausible distractors, "the answer
   cannot appear in the stem". The real P1–P11 prompts are written in sub-phase 8.3; the stub is
   what keeps those rules attached to the type rather than to whoever writes the prompt.

8. **Storybook story** — add a story next to the renderer covering at least `presenting`,
   `feedback` correct and `feedback` wrong, following
   `packages/activities/src/host/activity-host.stories.tsx` (each story drives the state through
   the real UI in its `play`). A type with a new interaction also needs a keyboard-only `play`,
   like `KeyboardOnlyDragAndDrop`. The type's fixtures appear in the `Activities/Fixtures`
   catalogue automatically.

## Verify

```
pnpm --filter @retenia/activity-schema test
pnpm --filter @retenia/activity-graders test:coverage
pnpm --filter @retenia/activities test          # includes the catalogue + axe suite
pnpm run schema:check
pnpm typecheck && pnpm lint
```

`pnpm --filter @retenia/activities storybook` for the visual pass.

## Reminders

- Ids on generated activity instances are UUIDv7; ids inside a payload are short strings
  unique within the activity.
- `type ∈ family` is enforced by the envelope schema; the LLM-facing schema is the
  `ActivityDraft` (no `id`) of one family with `type` narrowed to an allow-list.
- UI strings never come from an i18n hook inside `packages/activities`: add them to
  `ActivityLabels` in `src/labels.ts` with an English default, and the app passes its `es-AR`
  strings in through the `labels` prop.
- A type whose family has no renderer yet must not be registered — `defineActivityType` throws
  rather than let `<ActivityHost/>` mount nothing.
