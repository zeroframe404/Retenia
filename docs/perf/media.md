# Media ingestion: measured behaviour

Numbers from sub-phase 6.4, measured on the committed fixture
(`packages/ingest/test/fixtures/media/sample-20s.webm`) with the pinned ffmpeg
(`autobuild-2026-09-06-13-06`) and whisper.cpp `v1.9.2`. Like `rag.md`, this is a record of
runs rather than of decisions — the decisions are in `docs/spec/07-architecture.md` §13.4.

## The scene threshold misses slide decks

`docs/spec/05-ingestion-rag.md` §1 prescribes `select='gt(scene,0.3)'` for keyframe extraction,
with `fps=1/10` as the fallback. Measured on the fixture, whose video is three flat colour
fields cutting at 0, 7 and 14 seconds:

| `gt(scene, …)` | Frames selected |
|---|---|
| 0.001 | 3 |
| 0.01 | 3 |
| 0.1 | 2 |
| **0.3 (the spec's)** | **0** |

ffmpeg normalises `scene` by frame complexity, so a hard cut between two low-detail frames
scores well below a cut in camera footage. A full-frame colour change — which is what a slide
transition *is* — lands between 0.1 and 0.3.

The consequence is worth stating plainly, because it inverts the obvious reading of the spec:
**screencasts are the content the scene filter is worst at, and screencasts are most of what a
course folder contains.** The `fps=1/10` interval pass is therefore not an edge case but the
normal path for the Udemy-style material this feature exists for.

The threshold is left at the spec's 0.3 rather than lowered. For camera footage — a lecture
with cuts between speaker and slides — 0.3 is right and a lower value floods the budget with
near-duplicates that dHash then has to throw away. What carries screencasts is the fallback,
which `sceneDetectionFailed` triggers whenever the scene pass finds fewer frames than the
20-per-hour floor. `packages/ingest/src/media/keyframes.ts` holds both rules.

## The floor has to be one, not twenty per hour

20 frames/hour is 0.11 frames in a 20-second clip, so a naive `round(rate × hours)` yields zero
for exactly the sample the acceptance criterion ("≥ 1 keyframe") is written against.
`minimumKeep` never returns less than 1 for a source with any video at all.

## End to end on the fixture

`parseMedia` over the 20-second sample, CPU, `ggml-tiny`, VAD on: **~1.6 s** wall clock for
probe + WAV extraction + transcription + two keyframe passes + assembly. The transcript comes
back verbatim and the language is detected as `en`.

Not measured, and worth saying so rather than implying otherwise:

- Any Spanish audio. The fixture's speech is English, while `es-AR` is the product's first
  locale, so nothing here says what word error rate a Spanish lecture gets.
- `ggml-small-q5_1` (the shipped default) or `ggml-large-v3-turbo-q5_0`, on CPU or CUDA. The
  real-time factors in `weights.ts` are estimates used only to size a timeout.
- A course of any real length. Everything above is one 20-second part.
