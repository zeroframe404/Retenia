Source: Retenia research PDF v1.0 (Sep 2026), section 9

# AI providers, prices and costs

Which AI does what, how much it costs (official prices verified on 1-Sep-2026) and how it is
abstracted so the provider can be swapped without touching the app. Covers text, voice,
pronunciation, image, diagrams and video, plus the consolidated monthly budget.

## Table of contents

- [1. Text models: the September 2026 snapshot](#1-text-models-the-september-2026-snapshot)
- [2. Relevant mechanics](#2-relevant-mechanics)
- [3. Quality benchmarks](#3-quality-benchmarks)
- [4. Provider matrix by task](#4-provider-matrix-by-task)
- [5. Monthly text cost (intensive user)](#5-monthly-text-cost-intensive-user)
- [6. Structured outputs, AI SDK 7 and provider abstraction](#6-structured-outputs-ai-sdk-7-and-provider-abstraction)
- [7. Local models on the RTX 4070 Super (12 GB)](#7-local-models-on-the-rtx-4070-super-12-gb)
- [8. Privacy, limits and Argentina](#8-privacy-limits-and-argentina)
- [9. Voice: pronunciation assessment](#9-voice-pronunciation-assessment)
- [10. "I want to sound Irish": the Accent Lab](#10-i-want-to-sound-irish-the-accent-lab)
- [11. Voice: STT, TTS and real time](#11-voice-stt-tts-and-real-time)
- [12. Audio implementation in Electron](#12-audio-implementation-in-electron)
- [13. Image, diagrams and video](#13-image-diagrams-and-video)
- [14. Consolidated monthly budget](#14-consolidated-monthly-budget)

---

## 1. Text models: the September 2026 snapshot

The market changed a lot compared with 2025. Anthropic sells Claude Sonnet 5 (USD 2/10),
Opus 5 (5/25), Haiku 4.5 (1/5) and the top tier Fable 5.1 / Mythos 5.1 (10/50); all the 4.6+
models have 1M of context at a flat price and 128K of output. OpenAI replaced GPT-5.x with
GPT-5.6 Sol / Terra / Luna (4/20 promotional until 21-Nov, 2/12, 0.20/1.20). Google: Gemini
3.7 Flash (0.75/3.75 until 31-Dec-2026; 1.50/7.50 from 2027), 3.5 Flash-Lite (0.30/2.50),
3.1 Pro Preview (2/12). DeepSeek moved to V4 Flash/Pro with peak/off-peak pricing from
16-Aug (Flash off-peak 0.22/0.66; the whole Argentine working day falls in off-peak).

Prices are USD per 1M tokens unless stated otherwise.

| Provider · model | ctx | In | Cache read | Out | Batch | Input modalities | Strict JSON |
|---|---|---|---|---|---|---|---|
| Anthropic · Fable 5.1 / Mythos 5.1 | 1M | 10 | 0.25 | 50 | 50 % | text, image, native PDF | ✔ |
| Anthropic · Opus 5 | 1M | 5 | 0.50 | 25 | 50 % | text, image, PDF | ✔ |
| Anthropic · Sonnet 5 | 1M | 2 | 0.20 | 10 | 50 % | text, image, PDF (600 pages per request) | ✔ (no beta header) |
| Anthropic · Haiku 4.5 | 200K | 1 | 0.10 | 5 | 50 % | text, image, PDF | ✔ |
| OpenAI · GPT-5.6 Sol / Terra / Luna | 1.05M | 4 / 2 / 0.20 | 0.40 / 0.20 / 0.02 | 20 / 12 / 1.20 | 50 % | text, image, PDF (`input_file`) | ✔ strict |
| Google · Gemini 3.1 Pro Preview | 1M | 2 (≤ 200K) / 4 | 0.20 / 0.40 + storage | 12 / 18 | 50 % | text, image, PDF (258 tok/page), audio (32 tok/s), video (263 tok/s) | ✔ |
| Google · Gemini 3.7 Flash | 1M | 0.75 (2026) / 1.50 | 0.075 | 3.75 / 7.50 | 50 % | everything (image, PDF, audio, video) | ✔ |
| Google · Gemini 3.5 Flash-Lite · 2.5 Flash-Lite | 1M | 0.30 · 0.10 | — | 2.50 · 0.40 | 50 % | everything | ✔ |
| DeepSeek · V4 Flash (off-peak / peak) | 1M | 0.22 / 0.44 | 0.007 | 0.66 / 1.32 | ✘ (off-peak) | text (vision only `-vision-exp`) | JSON mode |
| Moonshot · Kimi K3 · K2.6 | 1M · 256K | 3 · 0.95 | 0.30 · 0.16 | 15 · 4 | — · 60 % | text, image (K2.6: video) | JSON mode |
| Alibaba · qwen3.7-flash (≤ 32K) · qwen3.6-plus | 1M | 0.03 · 0.5 | 0.006 · — | 0.13 · 3 | ? | image, text, video · text | OpenAI-compatible |
| Z.ai · GLM-5.3 · GLM-5.3-Flash (promo) | 1M | 1.4 · 0.075 | 0.26 · 0.015 | 4.4 · 0.25 | — | text · video/image/file | ✔ |
| xAI · Grok 4.6 · Grok 4.1 Fast | 500K · 2M | 2 · 0.20 | 0.50 · — | 6 · 0.50 | — | image | ✔ |
| Mistral · Medium 3.5 / Large 3 / Small 4 | — | 1.5 / 0.5 / 0.15 | −90 % | 7.5 / 1.5 / 0.6 | 50 % | image (OCR separately USD 4/1,000 pages) | ✔ |
| OpenRouter (aggregator) | — | provider's price + 5.5 % fee when buying credits (card, AliPay, USDC); routing with fallback; cache passthrough | | | ✘ | depends on model | ✔ |

## 2. Relevant mechanics

- **Anthropic prompt caching:** write 1.25× at 5 min or 2× at 1 h; read 0.1×; minimum 1,024
  tokens in Sonnet 5, 4,096 in Haiku.
- **Batch API 50 % off everything** (up to 100,000 requests, "most finish in under 1 h",
  maximum 24 h), compatible with caching and structured outputs.
- **Claude's native PDF converts each page to an image** (300 pages ≈ 0.9–1.3M tokens →
  extract text locally and send only pages with figures).
- **Gemini charges 258 tokens per PDF page** and its Files API retains 48 h.
- **Gemini's free tier uses the data to improve products** (the paid tier does not).

## 3. Quality benchmarks

**Arena** (ex LMArena, 1-Sep-2026, text): `claude-fable-5` 1507, `claude-opus-4-6-high` 1505,
`claude-opus-4-7-high` 1502, `claude-opus-5-high` 1492 (#7), `gemini-3.7-flash-high` 1491
(#9), `kimi-k3-max` 1489, `gemini-3.1-pro-preview` 1487, `glm-5.3-max` 1483, `gpt-5.6-sol`
1483.

**Artificial Analysis Intelligence Index v4.1.1:** Opus 5 63 (USD 2.34 per index task),
Fable 5 62, GPT-5.6 Sol 61, Grok 4.6 61, Kimi K3 60, GLM-5.3 60, Qwen3.8 Max 58, GLM-5.3-Flash
57 (USD 0.09 per task), Gemini 3.7 Flash 56 (0.40), Sonnet 5 55 in max mode (1.72 because of
the thinking: use `effort: low/medium` on simple tasks), DeepSeek V4 Pro 53.

**Reading:** Anthropic dominates the top; Gemini 3.7 Flash is 1 point from Opus 5 in human
preference while costing 7× less; GLM-5.3-Flash and Qwen3.8-Flash are the best "intelligence
per dollar". There is no public table per language: build your own eval of 50 items in
Spanish (theory, grading, tone) before fixing the commercial model (< USD 2 per run).

## 4. Provider matrix by task

| Task | Smart tier | Cheap tier | Fallback | Rationale |
|---|---|---|---|---|
| Ingestion + structured path with citations | Claude Sonnet 5 (batch + 1 h cache; Opus 5 optional) | Gemini 3.7 Flash (batch) | GPT-5.6 Terra; DeepSeek V4 Pro via OpenRouter | 1M flat, native PDF, strict JSON, batch 50 %; USD 1.4–2.8 per book |
| Theory, flashcards, exercises JSON | Claude Sonnet 5 (effort medium) | Gemini 3.7 Flash / GLM-5.3-Flash | GPT-5.6 Terra | Structured outputs + streaming per item |
| Grading free answers + explanation | Sonnet 5 (cached rubric) | Gemini 3.7 Flash | GPT-5.6 Luna | High volume (500/month): Flash ≈ USD 1.7; Sonnet ≈ 3.5 |
| Chat / tutor with RAG | Sonnet 5 (cache of system + sources) | Gemini 3.7 Flash | DeepSeek V4 Flash / Qwen3.6-plus | Latency and cost; citations from the local index |
| Prior-knowledge diagnostic | Sonnet 5 | Gemini 3.7 Flash | GPT-5.6 Terra | Pedagogical judgement; low volume |
| Classification, tagging, hints | Qwen3.7-flash / GPT-5.6 Luna / DeepSeek V4 Flash | Local: qwen3.5:9b / gemma4:12b | Gemini 3.5 Flash-Lite | Cents; local if the user enables it |
| Vision (keyframes, diagrams) | Gemini 3.7 Flash | Qwen3.7-flash / Gemini 3.5 Flash-Lite | GLM-5.3-Flash | 258 tokens per image in Gemini; Claude is 5–6× more expensive per image |
| Audio (transcription) | Gemini 3.7 Flash (32 tok/s) | Local Whisper | Gemini 3.5 Flash-Lite | Claude and GPT-5.6 do not accept audio |
| Embeddings | text-embedding-3-small / voyage-4-lite | Local EmbeddingGemma / bge-m3 | Mistral embed | Free and private; a single space |
| OCR of scans | Mistral OCR 4.1 | Gemini 2.5 Flash-Lite | LlamaParse free tier | USD 0.25–4 per 1,000 pages |

## 5. Monthly text cost (intensive user)

**Assumptions:** 2 new paths (2 × 740k/130k tokens), 30 standalone lessons (510k/90k), 500
gradings (1.25M/0.2M, ~60 % cacheable), 300 RAG chat turns (1.8M/0.15M, ~50 % cacheable)
≈ 5.0M input / 0.7M output.

| Configuration | USD / month |
|---|---|
| All Opus 5 unoptimized / with batch + cache | 42.7 / ≈ 33 |
| All Sonnet 5 unoptimized / with batch + cache | 17.1 / ≈ 13 |
| All GPT-5.6 Terra · All Gemini 3.1 Pro | 17.9 · 18.5 |
| All Gemini 3.7 Flash (2026 / 2027) | 6.4 / 12.8 |
| All GPT-5.6 Luna · All DeepSeek V4 Flash (off-peak / peak) | 1.85 · 1.6 / 3.1 |
| **Recommended hybrid** (paths and lessons on Sonnet 5 batch; grading and chat on Gemini 3.7 Flash; tagging local or Qwen) | **≈ 8.8** (+30 % margin for thinking/retries ≈ **11.5**) |
| Premium hybrid (Opus 5 for paths and error explanations) | ≈ 18–22 |

## 6. Structured outputs, AI SDK 7 and provider abstraction

### Support

- Anthropic `output_config.format = json_schema` (compiled grammar, 24 h cache).
- OpenAI `text.format` + `strict: true` (Responses API, explicit refusals).
- Gemini `responseJsonSchema` (broad subset).
- DeepSeek/Kimi/Qwen/GLM JSON mode (validate with Zod and retry).
- Ollama/LM Studio with a local grammar (JSON always valid).

### Vercel AI SDK 7 (ESM-only, Node ≥ 22)

`generateText`/`streamText` + `Output.object({ schema })`, `Output.array` with
`elementStream` (each item arrives complete and validated), `partialOutputStream`,
`NoObjectGeneratedError` errors; first-party providers `@ai-sdk/anthropic`, `openai`,
`google`, `deepseek`, `mistral`, `xai`, Moonshot, Alibaba;
`@openrouter/ai-sdk-provider`; `@ai-sdk/openai-compatible` for LM Studio
(`http://localhost:1234/v1`), Ollama (`:11434/v1`), Z.ai, MiniMax, Kimi, Qwen;
`transcribe()` and `generateSpeech()` stable; tool approval policies ("the AI wants to create
40 cards, do you confirm?").

### Long outputs

Never the path as one giant JSON: skeleton (< 8K tokens) → one call per lesson (2–6K) in
parallel/batch → flashcards/exercises with `Output.array` persisting each item; if
`finishReason === 'length'`, continue "from item N" with the valid partial JSON. Maximum
output: **128K in Claude 5.x / GPT-5.6; 64K in Haiku 4.5 and Gemini 3.x**.

### Abstraction (`packages/ai`)

**Profiles**

```ts
{ id, kind, baseURL, keyRef, models[],
  pricing { in, out, cachedIn, batch, date },
  caps { pdf, image, audio, video, jsonStrict, maxOutput, ctx } }
```

**Roles:** `smart | cheap | vision | audio | embed | local`, mapped by the user.

**Every call goes through** `runJob(role, schema, prompt, { batchable, cacheKey })`;
"premium" adapters only at three points (cache, batch, PDF/Files); uniform validation and
repair with Zod; middleware that records `usage` (including `cachedInputTokens`,
`reasoningTokens`) and computes the cost with a **versioned, editable pricing table**;
ordered fallback on 429/5xx/timeout (or OpenRouter `:floor`/`:exacto`); contract tests with a
golden set of 20 Spanish lessons; concurrency with `p-queue`; **monthly budget with alerts at
80/100 % and optional blocking**; the future commercial proxy is just another profile
(`kind: 'proxy'`).

## 7. Local models on the RTX 4070 Super (12 GB)

| Model (Ollama) | Download | Modalities | Recommended use |
|---|---|---|---|
| `qwen3.5:9b` | 6.6 GB | text + vision, 201 languages, 256K | All-rounder: tagging, hints, flashcards from notes, chat over notes (context ≤ 16K) |
| `gemma4:12b` | 7.6 GB | text + image, thinking, function calling | Better in Spanish/writing; simple grading |
| `gemma4:e4b` | 9.6 GB | text + image + audio | Local voice notes |
| `qwen3.5:4b` / `2b` | 3.4 / 2.7 GB | text + vision | Ultra-fast classification |
| `qwen3-embedding:0.6b` / `4b` · `bge-m3` · `embeddinggemma` | 0.6–2.5 GB | 100+ languages | RAG embeddings |
| `gpt-oss:20b` · `qwen3.8:27b` | 14 / 18 GB | — | Do not fit in 12 GB without heavy offload |

**Expected throughput (estimate):** 9B ≈ 50–70 tok/s, 12B ≈ 35–50 tok/s; prefill 1–2K tok/s
→ a 30K context takes 15–30 s before the first token: keep `num_ctx` ≤ 16–32K.

**What not to send local:** paths from complete books, grading with nuanced explanation, long
JSON (> 4K tokens), the diagnostic.

**Rule:** "local" is just one more provider, opt-in, with a cloud fallback.

## 8. Privacy, limits and Argentina

**Training on API data:** Anthropic no ("we will not use your inputs or outputs… to train");
OpenAI no (abuse logs 30 days; `store: false`); Gemini free tier yes (with human review),
paid no; DeepSeek stores in the PRC and may use the data unless you opt out; OpenRouter does
not log by default; Kimi/Z.ai/MiniMax/Qwen **(unverified)**. For the commercial product:
default providers Anthropic/Google paid/OpenAI; the Chinese ones as an explicit user option
and never for sensitive content.

**Limits for an individual user:** Anthropic 1,000 RPM / 2M ITPM / 400K OTPM from the Start
tier (cap USD 500/month; cached tokens do not count); OpenAI Tier 1 (USD 5) = 100/month, Tier
2 (USD 50) = 500/month; Gemini Tier 1 with USD 10 per 10-minute spend window (use Batch for
large lots); Kimi 200 RPM with USD 10 accumulated.

**Argentina** appears on the supported-country lists of Anthropic, OpenAI and Gemini. All
charge prepaid credits in USD by card; OpenRouter accepts card, AliPay and USDC (5.5 % fee).
**(unverified):** tax withholdings on foreign-currency consumption and the compatibility of
local cards with Stripe in each console → test it; if it fails, OpenRouter with USDC or an
international prepaid card. For the commercial model, note that an Argentine BYOK user pays
**21–30 % extra in taxes** on credits: an argument for a future "credit plan" in pesos.

## 9. Voice: pronunciation assessment

> **Decision.** Azure AI Speech **Pronunciation Assessment** is the only provider covering
> the 6 v1 languages with accuracy, fluency and completeness scores and per-phoneme output.
> Price verified in the Azure Retail Prices API: **USD 1.00/h** (same meter as real-time STT)
> **+ 0.30/h if prosody is enabled**; free tier F0 with **5 h/month**. JavaScript SDK
> (`microsoft-cognitiveservices-speech-sdk`) that works in the renderer (direct microphone,
> with 10-minute tokens issued by main) or in main (push stream PCM 16 kHz / 16-bit / mono).

### Azure PA capabilities

| Locales with PA | Scores | Only in `en-US` |
|---|---|---|
| `en-US`, `en-GB`, `en-AU`, `en-CA`, `en-IN` · `pt-BR`, `pt-PT` · `fr-FR`, `fr-CA` · `de-DE` · `it-IT` · `es-ES`, `es-MX` (+ `ar`, `ca`, `zh`, `da`, `nl`, `fi`, `hi`, `ja`, `ko`, `ms`, `nb`, `pl`, `ru`, `sv`, `ta`, `th`, `vi`). **`en-IE`, `en-NZ` and `es-AR` do not exist as assessment locales.** | `AccuracyScore` (phonemes vs native), `FluencyScore`, `CompletenessScore` (scripted), miscue (omission/insertion/mispronunciation), `ProsodyScore` (stress, intonation, speed, rhythm), aggregate `PronScore`; granularity Phoneme / Word / FullText with offset and duration; scripted (with `referenceText`) and unscripted modes; audio > 30 s in continuous mode (no miscue). | Prosody (+USD 0.30/h), content assessment (vocabulary/grammar/topic; removed from the SDK ≥ 1.46 → done with our LLM), IPA alphabet, `nBestPhonemeCount` (which phoneme you said instead of the expected one: e.g. [t] instead of [θ]), syllable groups. In other locales the phonemes come with an internal name (format **(unverified)**). |

### Pronunciation provider comparison

| Provider | v1 languages | Phoneme · fluency · prosody · content | Effective price | Monthly floor |
|---|---|---|---|---|
| **Azure PA** | 6/6 | ✔ · ✔ · `en-US` · via LLM | USD 1.00–1.30/h | 0 (F0 5 h) |
| Speechace | en, fr, es | ✔ + syllable · Pro+ · stress/intonation · IELTS/CEFR/PTE/TOEIC | 1.92/h overage | USD 40–125 |
| SpeechSuper | en (US/UK/IN), fr, de, es | ✔ · ✔ · stress · IELTS unscripted | ≈ 1.4/h | USD 20 |
| ELSA API | en | ✔ · ✔ · pitch/volume · grammar/vocab, IELTS | 1.92/h scripted · 4.80/h unscripted | 0 (self-serve) |
| Language Confidence | en | ✔ IPA · ✔ · — · IELTS/CEFR | not public | — |
| Google / Amazon | — | Do not offer pronunciation scoring as an API. | — | — |
| Open-source GOP (wav2vec2-espeak + alignment) | 6/6 | ✔ (PCC ≈ 0.5 vs 0.69 SOTA) · ✘ · ✘ · ✘ | 0 | weeks of R&D (v2, offline fallback) |
| Audio LLMs (Gemini, GPT-4o-audio) | all | ✘ **as a scoring engine**: over 1,800 utterances they diagnose by L1 stereotype (they flag stress errors in 82–96 % of the audios when only 4 % had them; only 15.8 % combine coherent reasoning and a correct rating). They serve as **verbalizers** of Azure's JSON + F0 (pitch correctness rises from 0.18 to 0.45–0.62 if they are given F0 values in text). | — | — |

## 10. "I want to sound Irish": the Accent Lab

No provider assesses against `en-IE`. The layered solution:

1. **Segmental scoring** with the closest locale (`en-GB`, or `en-US` if NBest and prosody
   are wanted), shown as "intelligibility", not as "Irishness".
2. **Curated per-accent phonological rules** (Irish: /θ, ð/ → [t̪, d̪], rhotic /r/,
   monophthongal FACE/GOAT, lenited final /t/) to decide with `nBestPhonemeCount` whether
   [t] for [θ] is an error or a feature of the target accent.
3. **Native reference voices:** Azure `en-IE-EmilyNeural` / `en-IE-ConnorNeural`, Polly
   Niamh, Deepgram Aura-2 Irish.
4. **Shadowing with our own acoustic comparison:** extract F0 from the TTS and from the user
   (`pitchy`, McLeod Pitch Method; 2,048-sample windows at 16 kHz; discard clarity < 0.9;
   semitones relative to the median), align with DTW over the word timestamps and plot both
   contours superimposed (correlation, pitch range, duration ratios).
5. **Per-accent minimal pairs** (tin/thin is almost homophonous in Irish → perception
   exercise).
6. **Optionally, an accent classifier** (SpeechBrain CommonAccent, 16 accents including
   Ireland; **(unverified)**) for a BoldVoice-style "distance to the target accent"
   (embeddings + PLS regression).
7. **The LLM writes the articulatory coaching in Spanish.**

**UX to copy (ELSA):** listen to the reference → record → global score + coloured words →
tap = phoneme + advice + "listen to just this word" (SSML `<phoneme>`) → retry; sessions of
≤ 5 sentences.

## 11. Voice: STT, TTS and real time

### STT

| STT | USD / h pre-recorded | Streaming | Notes |
|---|---|---|---|
| Groq whisper-large-v3-turbo | 0.04 | — | 216× realtime; 25 MB per file (chunk it) |
| AssemblyAI Universal-2 / 3.5 Pro | 0.15 / 0.21 | 0.15 | Diarization +0.02/h; 185 h free |
| Azure batch / fast / real-time | 0.18 / 0.36 / 1.00 | 1.00 | Same resource as PA; 5 h/month free |
| OpenAI gpt-4o-mini-transcribe / gpt-4o-transcribe | 0.18 / 0.36 | 1.02 (live) | 25 MB per file |
| ElevenLabs Scribe v2 | 0.22 | 0.39 | Files up to 3 GB / 10 h; diarization 32 speakers |
| Deepgram Nova-3 (mono / multi) | 0.26 / 0.31 | 0.29 / 0.35 | Keyterms; USD 200 of credit; ~300 ms |
| Gemini 3.x Flash (audio-in) | ≈ 0.12 | — | Up to 9.5 h per prompt; ideal for summaries, not precise SRTs |
| Local (RTX 4070 Super) | 0 | yes | Parakeet-TDT-0.6b-v3 (25 languages, WER 6.34 %; 20 h in 2–5 min), whisper-large-v3-turbo (10–15 min), whisperX with diarization (40–60 min); `sherpa-onnx` (Apache-2.0, Node addon, CUDA, bundles Parakeet, Whisper, Moonshine, Silero VAD, Kokoro and Piper) is the cleanest route; a bundled `whisper.cpp` CLI (CPU + CUDA) as an alternative that needs no compilation on the user's machine |

### TTS

| TTS | USD / 1M characters | Free | Accents / locales | Notes |
|---|---|---|---|---|
| Azure Neural (default) | 15 (Dragon HD 22) | 0.5M chars/month | 154 locales, 767 voices: `en-IE` 2, `en-GB` 20, `en-AU` 19, `en-IN` 20, `pt-BR` 28, `es-AR` 2, `es-ES` 24, `it-IT` 26, `de-DE` 23, `fr-FR` 23 | Full SSML (`<phoneme>`, `<prosody>`, styles), visemes, streaming; MAI-Voice-2 voices with 18 styles |
| ElevenLabs (premium, already contracted) | ≈ 100 (Multilingual v2 / v3) · ≈ 50 (Flash) | 10k credits | Voice Library filterable by accent; community Irish voices | Starter 6 / Creator 22 (220k chars v3) / Pro 99 plans; the credits↔characters relationship is **(unverified)** |
| Amazon Polly Neural / Generative | 16 / 30 | 1M neural (12 months) | `en-IE` Niamh; `es-US`, `pt-BR` | Speech marks |
| Google Chirp 3 HD / Neural2 | 30 / 16 | 1M | no `en-IE` | — |
| OpenAI gpt-4o-mini-tts | ≈ 15–20 (0.015/min; estimate) | — | `instructions` controls "accent" with no guarantee | Do not use as an accent reference |
| Deepgram Aura-2 | 30 | USD 200 | EN 35 voices (US/UK/AU/Irish), ES 17; no Portuguese | Low latency |
| Local: Kokoro-82M (Apache-2.0) | 0 | — | `en-US` 20, `en-GB` 8, `es` 3, `fr` 1, `it` 2, `pt-BR` 3 | Runs on CPU in real time; Chatterbox Multilingual (MIT, 23 languages, GPU) if more naturalness is wanted; Piper is GPL; XTTS is non-commercial |

### Real time (phase 2)

Gemini 3.1 Flash Live (USD 0.005/min in + 0.018/min out ≈ 0.012–0.023/min) and
gpt-realtime-mini (10/20 per 1M audio tokens ≈ 0.015–0.03/min) are the cheapest;
gpt-realtime ≈ 0.05–0.10/min; ElevenLabs Agents 0.08/min + LLM; Azure Voice Live ≈
0.03–0.06/min; an own pipeline with Pipecat/LiveKit Agents (open source) + Deepgram + a cheap
LLM + Azure TTS ≈ 0.01–0.02/min. **10 h/month of roleplay ≈ USD 8–18.** Start with Gemini
Live or gpt-realtime-mini over WebRTC directly from Electron.

## 12. Audio implementation in Electron

- `getUserMedia` mono + `AudioContext({ sampleRate: 16000 })` + AudioWorklet Float32 → Int16
  LE in frames of 20–100 ms (**do not trust the sampleRate constraint: Windows delivers
  48 kHz**).
- `MediaRecorder` (WebM/Opus) only for archiving.
- VAD with `@ricky0123/vad-web` (Silero v5) to trim silences (saves money) and detect the end
  of a phrase.
- **Expected latency:** Azure PA 0.5–1.5 s after the end of the phrase, Azure TTS first byte
  200–400 ms, Kokoro CPU ≈ 0.3× realtime.
- Store WAV 16 kHz + Azure's JSON (5–30 KB per phrase) in `userData/audio/<yyyy-mm>/`.
- **Offline:** local STT/TTS and approximate scoring marked as an estimate, queueing the audio
  for re-evaluation.
- **Anti-surprise:** a daily cap on assessed seconds, prosody only in `en-US`, TTS cache by
  `hash(text, voice, style)`.

## 13. Image, diagrams and video

### Image generation

| Image generation | USD / image (~1K) | Legible text | Notes |
|---|---|---|---|
| Google Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`) | 0.034 | Good | Cheap default; Interactions API; SynthID |
| Google Nano Banana 2 (`gemini-3.1-flash-image`) | 0.067 (2K 0.101; 4K 0.151) | Designed for "infographics, menus, diagrams" | Multi-turn conversational editing; up to 14 references; batch −50 % |
| Google Nano Banana Pro | 0.134 | Excellent | Premium |
| BFL FLUX.2 [pro] | 0.03 per MP | 4.83/5 | Best price/text ratio; multi-reference |
| Seedream 4.5 (fal) | 0.04 | 4.93/5 (#1 in text) | — |
| Recraft V4 Vector | 0.08 (Pro 0.30) | Good | The only one with native editable SVG: exercise icons |
| OpenAI gpt-image-2 | ≈ 0.02–0.05 medium (third parties; OpenAI publishes USD 30/M output tokens) | Very good | Requires organization verification; gpt-image-1.5/1-mini deprecated |
| xAI Grok Imagine · Qwen-Image · Ideogram | 0.02 · 0.003–0.035 · 0.03–0.10 **(unverified)** | Good · 4.64/5 · historically the best in typography | — |
| Local: FLUX.2 Klein 4B (Apache 2.0, FP8 ≈ 7 GB) · Z-Image Turbo (6B, Apache 2.0, 8 steps) | 0 | Acceptable · good | ComfyUI as an optional sidecar; the "normal" user will not have this GPU |
| **Discarded** | Midjourney (no API, ToS forbids automation), Imagen 4 (shut down 17-Aug-2026), Sora (API shuts down 24-Sep-2026), FLUX.2 dev 32B (non-commercial, does not fit in 12 GB) | | |

### Diagrams as code (default)

A Mermaid diagram is 150–600 tokens (≈ USD 0.0015 with Gemini Flash, 0.006 with Sonnet 5):
text always legible, editable, light/dark themes, and programmatic access to nodes for
hotspots and "complete the diagram".

- **High reliability** in flowchart, sequence, class, mindmap, timeline, ER (7B models
  already achieve ~91 % valid syntax in sequence diagrams); **low** in xychart/block/architecture.
- **Pattern:** ask for Mermaid with structured output (`mermaid` + `alt_text` + `nodes[]`) →
  `mermaid.parse()` → send the error back to the LLM (max. 2) → fall back to Graphviz DOT
  (`@viz-js/viz`) → as a last resort, an image.
- **Complements:** Markmap (mind maps from Markdown), KaTeX (formulas; never images),
  Vega-Lite/Chart.js (data), Excalidraw (MIT; via "element skeleton"; tldraw discarded because
  of its mandatory watermark), Kroki only if there is a backend, Manim (low-medium
  reliability; experimental feature).

### Video

| Video (1 minute of explainer, with 2–3 retries per clip) | USD | Notes |
|---|---|---|
| Gemini Omni 1.1 Flash 720p (0.10/s; 360p draft 0.03/s) | ≈ 15 | Scenes extensible up to 40 s |
| Veo 3.1 Fast with audio (0.15/s) · Veo 3.1 standard (0.40/s) | ≈ 22 · ≈ 60 | 8 s per clip + extensions |
| Kling 3.0 with audio (0.126/s) · Hailuo 2.3 (≈ 0.05/s) · Runway Gen-4 Turbo (0.05/s) | ≈ 19 · ≈ 8 · ≈ 7.5 | No audio except Kling |
| HeyGen avatar (USD 3/min) | 3–4 | Talking bust; does not illustrate concepts |
| **Slides + TTS + Remotion (default)** | **0.05–0.20** | LLM → script by scenes → Mermaid/SVG + optional illustrations → TTS (local Kokoro or Azure) → Remotion composes an MP4 with subtitles; Remotion is free for individuals and teams ≤ 3 |

**A single 1-minute generative video consumes 30 % to 100 % of the monthly budget:** in v1
video is optional/premium with a visible per-clip cost.

**Miscellaneous:** DeepL API Free (500k chars/month, **(unverified)** today) or a cheap LLM
for translation (Gemini Flash-Lite ≈ USD 0.13 per million characters); ElevenLabs SFX
0.12/min and Music 0.15/min for jingles (< USD 0.50/month); Wolfram|Alpha LLM API free
non-commercial (SymPy via Pyodide in v1); code sandboxes: Pyodide (Python in WASM, free) +
QuickJS-WASM; E2B (USD 100 of credit) or self-hosted Judge0/Piston for compiled languages in
the version with a backend.

## 14. Consolidated monthly budget

| Item | Recommended route | Premium | Notes |
|---|---|---|---|
| Text (paths, lessons, grading, chat) | USD 9–14 | 18–22 | Sonnet 5 + Gemini 3.7 Flash + local · Opus 5 on paths and explanations |
| Voice (pronunciation 7–15 h, short STT, TTS 200k chars) | 6–14 | + real-time 8–18 | Azure PA (−5 h free) + local Whisper + Azure TTS inside the free tier; ElevenLabs already contracted separately |
| Media (100 images, 20 icons, 30 diagrams, OCR, embeddings, web, YouTube) | 5–6 | 20–30 | Nano Banana 2 Lite + Recraft Vector + Mermaid; premium with Nano Banana Pro and Mistral OCR |
| Generative video (2 min) | 0.20 (slides + TTS) | 25–45 | Opt-in only |
| **Total** | **≈ USD 20–34** | **≈ 70–115** | Inside 20–50 if video stays opt-in; recalculate in Q4-2026 because of the Gemini price rise in 2027 |
