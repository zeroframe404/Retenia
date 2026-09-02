---
name: add-activity-type
description: How to add a new learning activity type to packages/activities — registration, family payload schema, fixtures, Storybook story, grader tests, and generation prompt template. Use when asked to add, implement, or scaffold a new activity type.
---

# Add an activity type

Adding an activity type to `packages/activities` touches several places. Follow this checklist in order.

## Checklist

1. **Register the type** — create `packages/activities/types/<id>.ts` exporting an object implementing:
   - `type` — the activity type id (string, kebab-case)
   - `family` — which payload family it belongs to
   - `Renderer` — the React component that renders the activity
   - `grader` — pure function scoring a user's response
   - `validate` — zod validation for the activity's payload
   - `generator` — function/prompt hook producing new instances of this activity
   - `review` — how this activity type feeds into the FSRS review cycle
   - `capabilities` — declared capabilities (e.g. supports hints, supports media, supports voice)

2. **Family payload schema** — if `family` is new (not an existing payload shape), add its zod schema alongside the other family schemas so `validate` can reuse it.

3. **Fixtures** — add `packages/activities/fixtures/<id>.json` with representative sample payloads (idle, correct-answer, wrong-answer cases at minimum) for tests and Storybook to consume.

4. **Storybook story** — add a story for the `Renderer` covering at least three states: `idle`, `correct`, `wrong`. Place it next to the component per the existing `packages/ui`/`packages/activities` Storybook conventions.

5. **Grader unit tests** — write Vitest tests for `grader` covering correct answers, incorrect answers, partial credit (if applicable), and malformed/edge-case input.

6. **Generation prompt template** — add `packages/activities/prompts/<id>.md`, the prompt template used by `packages/ai` to generate instances of this activity type.

## Reminders

- `packages/activities` must not import Electron or Node-only APIs directly in shared logic — keep provider/IO concerns behind ports, consistent with `packages/core`'s zero-dependency rule.
- Ids on generated activity instances are UUIDv7.
- Run `pnpm test --filter @retenia/activities` and `pnpm typecheck` before considering the type complete.
