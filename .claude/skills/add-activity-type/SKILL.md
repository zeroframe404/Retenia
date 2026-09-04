---
name: add-activity-type
description: How to add a new learning activity type — registry row, family payload schema, validation rules, fixtures, grader and its tests, Storybook story, and generation prompt template — across packages/activity-schema, packages/activity-graders and packages/activities. Use when asked to add, implement, or scaffold a new activity type.
---

# Add an activity type

An activity type is spread over three packages (`docs/spec/03-activities.md` §7–§9): its data
contract and rules live in `packages/activity-schema`, its pure grader in
`packages/activity-graders`, and its renderer, story and prompt in `packages/activities`. Follow
this checklist in order.

## Checklist

1. **Register the type** — add or edit its row in `packages/activity-schema/src/registry.ts`
   (`ROWS`, in the order of the master table of `docs/spec/03-activities.md` §4). The row
   carries `type` (snake_case id), `family`, `category`, `grader` (`det | fuzzy | ai | self |
   speech | code | cas | none`), `ratingStrategy` (core's `RatingRule`: `binary | partial |
   fuzzy | ordering | matching | objective | ai | speech | self | none`), `complexity`,
   `phase`, `generation` and `media`. The registry test asserts the counts (98 types, 21 MVP,
   89 review-eligible), so update it when a row is added. Document any second admissible
   rating strategy or grading method in `REVIEW_ALTERNATES` / `GRADING_ALTERNATES`.

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
   `src/fixtures.test.ts` and the graders' `families/fixtures.test.ts` pick them up automatically.

5. **Grader** — implement or extend `packages/activity-graders/src/families/<family>.ts`
   (pure: no Node, Electron or provider imports), returning `GradeResult` with `rating: null`
   (`rateResult` fills it through core's `toRating`). Keep branch coverage at 100 %:
   `pnpm --filter @retenia/activity-graders test:coverage`.

6. **Storybook story** — add a story for the `Renderer` in `packages/activities` covering at
   least `idle`, `correct` and `wrong`, next to the component.

7. **Generation prompt template** — add `packages/activities/prompts/<id>.md`, the prompt
   template `packages/ai` uses to generate instances of this type.

## Reminders

- Ids on generated activity instances are UUIDv7; ids inside a payload are short strings
  unique within the activity.
- `type ∈ family` is enforced by the envelope schema; the LLM-facing schema is the
  `ActivityDraft` (no `id`) of one family with `type` narrowed to an allow-list.
- Run `pnpm --filter @retenia/activity-schema test`, `pnpm --filter @retenia/activity-graders
  test:coverage`, `pnpm run schema:check` and `pnpm typecheck` before considering the type complete.
