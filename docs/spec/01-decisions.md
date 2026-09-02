Source: Retenia research PDF v1.0 (Sep 2026), sections 1, 2, 3 and 13

# Decisions

Every decision already taken for Retenia: platform, product model, scheduler, provider
matrices, gamification, languages, v1 scope, working name, and the phased development
plan. Sections 1 and 2 are the decisions themselves; section 3 (competitive landscape)
is kept as an appendix because it is the evidence behind them; section 13 is the
development plan those decisions feed.

## Table of contents

- [1. What Retenia is](#1-what-retenia-is)
- [2. Headline numbers](#2-headline-numbers)
- [3. The decisions already taken](#3-the-decisions-already-taken)
- [4. The five focuses, as requirements](#4-the-five-focuses-as-requirements)
- [5. Decisions taken in the question rounds](#5-decisions-taken-in-the-question-rounds)
- [6. v1 scope and non-goals](#6-v1-scope-and-non-goals)
- [7. Design principles that govern everything](#7-design-principles-that-govern-everything)
- [8. Working name and name proposals](#8-working-name-and-name-proposals)
- [9. Honest warnings](#9-honest-warnings)
- [10. Development plan (section 13)](#10-development-plan-section-13)
- [Appendix A. Competitive landscape (section 3)](#appendix-a-competitive-landscape-section-3)

---

## 1. What Retenia is

Retenia (working name) is a desktop program for learning and not forgetting. It combines
three things that today live in separate products:

1. **Duolingo-style learning paths** — linear and gamified, where every lesson has a
   theory part and a practice part.
2. **Those paths are generated with AI from your own sources** (PDF books, video
   courses, links, DOCX, images, audio), NotebookLM-style, and are then **frozen** so
   you can complete them.
3. **A state-of-the-art memory system** (FSRS-6, the same algorithm adopted by Anki and
   RemNote) with per-item importance levels, dated exams, mock exams and — above all —
   **interactive exercises scheduled by the same scheduler as the flashcards**.

Everything local-first, with your own API keys and several specialized AIs (text, voice,
pronunciation, image).

### Why nobody has it yet

After reviewing more than 40 products: nobody combines linear paths generated from your
own sources with a transparent FSRS scheduler, per-item importance, dated exams and
interactive exercises inside the memory system.

- **RemNote 1.28** (August 2026) is the closest competitor — it has FSRS, Exam Scheduler
  and a "Guided Learn Mode" — but no gamified path and no exercises beyond MCQ/cloze.
- **Kinnu** has paths but no own sources and no FSRS.
- **Anki** generates nothing.
- **Duolingo** does not accept your own content.
- **SuperMemo** has the most sophisticated priority system on the market with a 1995
  interface.
- **Google Learn Your Way** proved in a controlled trial that transforming a source into
  multiple formats with comprehension checks improves retention (+11 points at 3–5 days),
  but it is a laboratory experiment.

### How to use this document and its companion

| This PDF | `prompts.md` |
|---|---|
| It is the "what" and the "why": the verified research (prices and features checked on 1 September 2026), the design decisions, the algorithms with formulas, the feature catalogue and the architecture. Read it through once; afterwards consult it by section when Claude Code asks you something or when you want to change a decision. | It is the "how": a phase 0 of configuration and 14 development phases divided into 76 sub-phases, each with a self-contained prompt in English, acceptance criteria, verification commands, and the recommended model (Haiku 4.5 / Sonnet 5 / Opus 5 / Fable 5.1) and effort (Bajo / Medio / Alto / Extra / Max / UltraCode). Section 13 explains how they map to Claude Code's real controls. |

## 2. Headline numbers

| Figure | Meaning |
|---|---|
| **USD 9–14** | Estimated monthly AI cost for you as an intensive (text) user, inside the USD 20–50 budget |
| **≈ USD 3–6** | Generating a complete path from a 300-page book (batch + cache) |
| **98** | Interactive activity types catalogued; **21** in the MVP |
| **76** | Sub-phases across 15 phases (F0–F14), each with prompt, model and effort for Claude Code |
| **40–55 person-weeks** | Full v1 on Windows; **12–16** for a usable MVP (review + editor + PDF + generated paths) |

## 3. The decisions already taken

| Area | Decision | Detail |
|---|---|---|
| **Platform** | Electron 44 + React 19 + TypeScript | Windows 11 first, macOS later (Intel and Apple Silicon). A single Chromium engine for video, PDF, microphone and WASM. Tauri discarded because of WebKit on Mac and because of the Node ingestion ecosystem. |
| **Product model v1** | Own use, 100 % local, BYOK | No backend and no accounts. You load your own keys (stored with `safeStorage`). The data schema is born **sync-ready** (UUIDv7, soft deletes, outbox) so accounts, licences and sync can be added without a rewrite. |
| **Memory scheduler** | FSRS-6 via `ts-fsrs` | 21 per-user optimizable parameters, "desired retention" as the importance lever. SM-2 only for importing. Exam mode built as a layer on top. |
| **Text AI** | Claude Sonnet 5 + Gemini 3.7 Flash + local | Sonnet 5 (USD 2/10 per million) generates paths, lessons and exams with batch and cache; Gemini 3.7 Flash corrects, chats and processes volume; Ollama/LM Studio on the RTX 4070 Super for embeddings and light tasks. |
| **Voice** | Azure AI Speech (pronunciation) + local Whisper + Azure TTS / ElevenLabs | The only provider with pronunciation assessment in the 6 v1 languages. USD 1.00/h (+0.30 with prosody); 5 h/month free. Irish accent via `en-IE` voices and shadowing with an intonation curve. |
| **Media** | Diagrams-as-code + Nano Banana 2 Lite + "light" video | Mermaid/Excalidraw/KaTeX for diagrams (cents); images at USD 0.034; generative video only opt-in (USD 8–60 per real minute). Default: slides + TTS + Remotion. |
| **Fixed path with remediation** | Frozen PathSpec + optional mini-lessons | The path does not change; the AI inserts reinforcement detours (`L07.r1`) without renumbering and raises the priority in memory. Adaptive diagnostic of 25–30 items to mark what you already know. |
| **Gamification** | Full Duolingo-style + "sober mode" | XP, streaks with freezes, separate goals, quests, achievements, mascot; **errors are never punished** (no hearts). Sober toggle for adults and B2B. |

## 4. The five focuses, as requirements

| Focus | What you asked for | How it translates into product (and where it is detailed) |
|---|---|---|
| **1 · Duolingo-style paths** | Linear lesson path; each lesson with theory and practice; reinforcement modules, self-test style, with flashcards. | Structure Sections → Modules → Lessons → Reinforcement nodes every 3–5 lessons, cumulative checkpoints and a final exam. Each lesson: hook, activation, explanation with citations, worked example, diagram, misconceptions, summary + 4–8 activities (≥3 types, max. 40 % MCQ, ≥1 at the "apply" level). See §7 and §11. |
| **2 · Generated with AI from your sources** | Load PDF books, videos, module-based courses, links, DOCX, images, audio; a "Generate with AI" button; fixed path; prior-knowledge test or "from scratch". | "Outline first, then expand" pipeline in 10 stages with automatic QA; frozen and versioned PathSpec; adaptive diagnostic (Elo-lite + prerequisites, 25–30 items) that marks lessons as completed and seeds their memory with low priority. See §7 and §8. |
| **3 · Memory system (the most important)** | Per-concept importance (urgent vs maintenance), mock exams, schedulable exams; not only flashcards but interactive exercises Storyline/Captivate/Moodle style. | FSRS-6 with "desired retention" per importance level (Urgente 0.95–0.97 · Alta 0.92 · Normal 0.90 · Mantenimiento 0.80–0.85 · Pausado), auto-postpone that protects what matters, dated exams as a layer over the scheduler, blueprint-driven mock exams, and 89 of the 98 activity types mapped to the scheduler's 1–4 scale. See §5 and §6. |
| **4 · Several AIs by API with credits** | Image, video, audio, smart text and fast/cheap text, speech recognition that corrects pronunciation/intonation/accent; quality without exploding the cost; possibly Claude. | Matrix of 6 primary providers (Anthropic, Google, Azure Speech, ElevenLabs, Google/BFL for image, local) with fallbacks. Monthly budget and per-call cost counter inside the app. See §9. |
| **5 · The largest possible number of features** | Everything good from RemNote, SuperMemo and company; a "really powerful" system. | Master catalogue of 125 features tagged MVP / V1 / V2 / Later, with attribution of where each idea comes from. See §12. |

## 5. Decisions taken in the question rounds

| Question | Your decision | Implication in the plan |
|---|---|---|
| Desktop stack | Electron + React + TypeScript | A single Chromium (152) and Node 24 in the main process; same base as your DM Gestión program; Node ingestion ecosystem. Installer ≈ 90–120 MB. |
| Product model v1 | Own use, 100 % local, with your API key | No backend, accounts or payments in v1. Designed "sync-ready" (UUIDv7, soft deletes, outbox, repositories behind ports) so as not to rewrite when commercializing. |
| AI budget | USD 20–50 / month | Hybrid matrix ≈ USD 9–14 (text) + USD 6–14 (voice) + USD 5–6 (media) under intensive use: fits with margin if generative video stays opt-in. |
| Languages with pronunciation | English + Portuguese, French, German, Italian, Spanish | Azure AI Speech is the only one covering the 6 (`en-US/GB/AU/CA/IN`, `pt-BR/PT`, `fr-FR/CA`, `de-DE`, `it-IT`, `es-ES/MX`). Prosody only in `en-US`; `en-IE` does not exist as an assessment locale (solved with "Accent Lab"). |
| Videos | Transcribe audio + capture key frames | Local Whisper, free (Parakeet/whisper-turbo via sherpa-onnx or whisper.cpp) + 20–60 keyframes per hour → cheap OCR/vision (Gemini Flash-Lite or Qwen3.7-flash). Never send the whole video (20 h ≈ 19 M tokens). |
| Local AI | Yes, as an optional provider for light tasks | Ollama/LM Studio as "one more provider" with cloud fallback: embeddings, tagging, hints, chat over notes. Never for generating complete paths. |
| Import/export v1 | Anki (`.apkg`) and CSV; RemNote; Markdown/Obsidian | Own `.apkg` parser (legacy 2 and anki21b with zstd), RemNote via its Anki/OPML/Markdown export, Obsidian with the Spaced Repetition plugin syntax; Markdown and own `.apkg` export. |
| Fixed path vs. reinforcement | Insert reinforcement mini-lessons without altering the base path | Remediations with a derived id (`L07.r1`), optional, at most 1 active per module and 3 per week, triggered by the memory system, by reinforcement or by the user. |
| Name | Retenia (working) | `retenia.app` / `retenia.io` with no DNS (possibly free); `.com` taken. Verify WHOIS and INPI before fixing the brand. The 12 proposals are at the end of this section. |
| Prompts | In English; with Claude Code setup; very detailed | `prompts.md`: a phase 0 of configuration + 14 development phases, 76 sub-phases with model and effort. |
| Platforms | Windows 11 first, Mac later | electron-builder with NSIS; macOS (arm64 + x64 separately, notarization with an Apple Developer account at USD 99/year) in the final phase. |
| Gamification | Full Duolingo-style + sober mode | XP, streaks with freezes, separate daily and streak goals, quests, achievements, mascot (Rive), optional leagues; errors are never punished. |
| Text providers | Claude Sonnet 5 + Gemini 3.7 Flash + local | "smart" and "cheap" roles, configurable; Opus 5 as an optional premium mode; Haiku 4.5 and Flash-Lite for bulk extraction. |

## 6. v1 scope and non-goals

### In v1 (Windows)

- Source library with local ingestion (PDF, DOCX, EPUB, MD/TXT, images, audio, video,
  YouTube, web) and local RAG.
- "Generate with AI": fixed path with diagnostic, theory+practice lessons,
  reinforcements, final exam; versioned regeneration.
- FSRS-6 memory system with importance, dated exams, mock exams, final drill,
  postpone/mercy, statistics.
- Activity engine with 21 MVP types, extended to ~50 in phases 2–3 (audio, image, code,
  games, voice).
- Languages module: pronunciation (Azure), dictation, listening, accent shadowing,
  multi-voice TTS.
- Notes editor with cloze/LaTeX/occlusion, PDF reader with highlights → cards, tutor
  with citations.
- Full gamification with sober mode; Anki/CSV/RemNote/Markdown import/export; signed
  auto-update.

### Explicitly NOT in v1

- User accounts, cloud sync, payments, licences, B2B (left prepared in the schema).
- Mobile (the core in `packages/core` is shared with a future Expo client).
- Generative video as the default (only opt-in with visible cost).
- Real-time voice conversation (phase 2; Gemini Live / gpt-realtime-mini).
- Offline pronunciation assessment (local GOP is an R&D project for v2).
- Path marketplace, third-party plugins, real-time collaboration.
- YouTube/Udemy download inside the base product (ToS); the user provides their own
  files.

## 7. Design principles that govern everything

1. **Evidence rules.** Retrieval practice and spacing are the only "high utility"
   techniques (Dunlosky 2013); everything ends in active recall with feedback, never in
   re-reading.
2. **The scheduler is transparent.** The user sees stability, retrievability and why
   something appears today; "how much this will cost me in reviews" accompanies every
   importance decision.
3. **Content ≠ presentation.** The same skill (concept) is reviewed in varied formats
   (Wordwall's "switch template" principle); the scheduler schedules skills, not screens.
4. **Fidelity to the sources.** Every substantive claim cites a block and page/timestamp;
   claims are verified; what is general knowledge is marked as such.
5. **Never punish the error.** Errors are scheduler data; no hearts and no lives (the
   lesson Duolingo learned with "Energy").
6. **Local-first and BYOK.** Your data on your PC, keys encrypted with DPAPI, visible
   per-call cost and a monthly budget with alerts.
7. **Determinism where it matters.** Path sequencing and the graders are pure code; the
   AI proposes, the code validates.
8. **Every phase leaves something usable.** The plan is ordered so that, from phase 4
   onward, you can really review in the app.

## 8. Working name and name proposals

Working name: **Retenia**.

> Verification performed: only DNS resolution of `.app`/`.com`/`.io` on 1-Sep-2026. "No DNS"
> suggests the domain could be free (it does not guarantee it). WHOIS and trademark search
> are still missing (INPI in Argentina, EUIPO/USPTO if expanding). **(unverified)**

| # | Name | Rationale | Domain hints |
|---|---|---|---|
| 1 | **Retenia ✔ chosen** | From "retener": memory that stays; sounds like a brand; easy in ES/EN. | `retenia.app`, `retenia.io` no DNS; `.com` taken. |
| 2 | Mentia | "Mente" + brand ending; short and pronounceable. | `mentia.app`/`.io` no DNS; `.com` taken. Risk: closeness to "dementia" in English. |
| 3 | Memtica | "Memoria" + "-tica" (technique/practice); sounds like a method. | `memtica.app` no DNS; `.com` taken. |
| 4 | Brotea | The knowledge that sprouts and grows; natural mascot (a sprout). | `brotea.app` no DNS; `.com` taken. |
| 5 | Aprendix | "Aprender" + tech suffix; clear for B2B in LatAm. | `aprendix.app` no DNS. |
| 6 | Anclaje | Anchoring knowledge; a psychology concept; very differentiated. | `anclaje.app` no DNS; `.com` taken; hard in English. |
| 7 | Retenta | Latin variant of "retener"; sonorous and trademarkable. | `retenta.app` no DNS; `.com` taken. |
| 8 | Fíjalo | Colloquial imperative "fíjalo en la memoria"; own LatAm voice. | `fijalo.app` no DNS; the accent complicates the domain. |
| 9 | Sendalab | "Senda" (path → routes) + lab. | `sendalab.app` no DNS; `senda.*` taken. |
| 10 | Retiene | Direct verb: "retiene lo que aprendés". | `retiene.app` no DNS; `.com` taken. |
| 11 | Evoca | Evocar = retrieve from memory (active recall); bilingual. | `evoca.app` and `.com` taken; viable only as "EvocaLab". |
| 12 | Lumbre | The ember that stays lit = the living streak. | `lumbre.app` taken; `lumbrelab.app` no DNS. |

## 9. Honest warnings

- **AI prices change week to week.** Everything was verified on official pages on
  1-Sep-2026, but Gemini doubles prices on 1-Jan-2027, DeepSeek went up 10× in August and
  OpenAI cut in July. Section 14 lists what to re-verify before fixing commercial prices.
- **Total scope is large:** some 40–55 person-weeks of development for the full v1 on
  Windows. The good news is that an MVP usable by you (review + editor + PDF + generated
  paths) is reachable in 12–16, and the plan is ordered so each phase leaves something
  usable.
- **Audio models are not usable for scoring pronunciation** (a 2026 study shows they
  diagnose by stereotype); that is why the assessment is done by Azure and the LLM only
  explains.
- **What could not be verified is marked in the text with the words "no verificado"**
  — rendered throughout these specs as **(unverified)** — and consolidated in section 14.

## 10. Development plan (section 13)

Fifteen phases (F0 configuration + F1–F14 construction), 76 sub-phases, ordered so that
each phase leaves something usable.

### 10.1 The phases at a glance

| Phase | Objective | Sub-phases | What is left usable | Dominant model |
|---|---|---|---|---|
| **F0 Setup** | Repo, CLAUDE.md, settings and hooks, subagents, skills, specs/ADRs from this PDF, base CI | 0.1–0.4 | A repo where Claude Code works with automatic verification | Sonnet 5 · Haiku 4.5 |
| **F1 Skeleton** | Monorepo + electron-vite, process security, typed IPC, `app://` and `media://` protocols, builder/updater/logging, tests | 1.1–1.5 | Empty app that installs, updates and logs | Sonnet 5 · Opus 5 |
| **F2 Design system and shell** | Tokens, Tailwind 4, shadcn/Base UI, dark mode, layout, router, command palette, i18n, Motion, Rive mascot, accessibility | 2.1–2.5 | Navigable shell with the visual identity | Sonnet 5 |
| **F3 Data** | Full Drizzle schema, migrations, repositories and ports, FTS5 + sqlite-vec, job queue, blobs, backups, keys | 3.1–3.5 | Robust local, sync-ready database (schema) | Opus 5 · Fable 5.1 |
| **F4 Memory** | FSRS-6, importance, daily session, review UI, exercise → rating, optimizer and overload tools | 4.1–4.6 | You can already review flashcards for real | Fable 5.1 · Opus 5 |
| **F5 Activity engine** | Schema per family, host, 21 MVP types, AI grading, session generator | 5.1–5.6 | Interactive exercises scheduled by the scheduler | Opus 5 · Sonnet 5 (UltraCode in renderers) |
| **F6 Ingestion and RAG** | Parsers, chunking, embeddings, hybrid retrieval, audio/video, web/YouTube, PDF/EPUB reader | 6.1–6.6 | Source library with search and highlights → cards | Sonnet 5 · Opus 5 |
| **F7 AI layer** | Providers, roles, costs, structured output, batch/cache, local, settings and evals | 7.1–7.5 | Any feature can request AI with visible cost | Opus 5 |
| **F8 Generate with AI** | Extraction, synthesis, sequencing, preview, expansion, QA, item bank, diagnostic, remediation | 8.1–8.6 | The "Generate with AI" button works | Fable 5.1 · Opus 5 |
| **F9 Paths in the UI** | Path map, lesson player, reinforcements, tutor with citations, notes editor | 9.1–9.5 | Full Duolingo experience | Sonnet 5 · Opus 5 |
| **F10 Exams** | Dated scheduler, mock exams, grading, analytics, plan and notifications | 10.1–10.4 | Studying toward a date | Opus 5 |
| **F11 Languages and voice** | Audio, Azure PA, TTS, Accent Lab, STT and dictation | 11.1–11.5 | Pronunciation in 6 languages | Opus 5 · Sonnet 5 |
| **F12 Media and code** | Images, diagrams and occlusion, light video, code sandboxes | 12.1–12.4 | Lessons with images, diagrams and runnable code | Sonnet 5 |
| **F13 Gamification, stats, import/export** | XP/streaks/goals, statistics, notifications, importers, onboarding | 13.1–13.5 | Complete product for you | Sonnet 5 · Haiku 4.5 |
| **F14 Release** | Hardening, performance, signing and installer, E2E, macOS, documentation | 14.1–14.5 | Installable and signed beta | Fable 5.1 (audit) · Opus 5 |

**Milestones:** after F4 you already review with FSRS; after F6 you already import your
books and videos; after F8 you already generate paths; after F9 you already study
"Duolingo-style"; after F10 you already prepare for an exam; after F13 you have the whole
product; F14 leaves it installable and signed. F11 and F12 can run in parallel
(worktrees) with F13.

### 10.2 The 76 sub-phases with model and effort

Index of `prompts.md`. Titles are in English because that is how they appear in the
prompts. **"Plan"** = start in plan mode (Shift+Tab) and approve the plan before
implementing; **"Directo"** = paste the prompt and let it implement.

| Sub-phase | Title (prompts.md) | Model | Effort | Mode | Depends on |
|---|---|---|---|---|---|
| 0.1 | Repository, CLAUDE.md, permissions and hooks | Sonnet 5 | Medio | Directo | — |
| 0.2 | Subagents and skills | Sonnet 5 | Medio | Directo | 0.1 |
| 0.3 | Extract the specification from the research PDF into docs/spec | Opus 5 | Alto | Plan | 0.1 |
| 0.4 | CI skeleton and repository hygiene | Haiku 4.5 | Bajo | Directo | 0.1 |
| 1.1 | Monorepo packages and electron-vite app | Sonnet 5 | Medio | Plan | 0.4 |
| 1.2 | Process security and typed IPC contract | Opus 5 | Alto | Plan | 1.1 |
| 1.3 | app:// and media:// protocols, windows, deep links | Sonnet 5 | Alto | Directo | 1.2 |
| 1.4 | Packaging, auto-update, logging and crash reporting | Sonnet 5 | Medio | Directo | 1.3 |
| 1.5 | Test infrastructure | Sonnet 5 | Medio | Directo | 1.4 |
| 2.1 | Design tokens, Tailwind 4, shadcn on Base UI, dark mode | Sonnet 5 | Medio | Directo | 1.5 |
| 2.2 | Application shell, router, command palette, i18n | Sonnet 5 | Alto | Plan | 2.1 |
| 2.3 | Core composite components | Sonnet 5 | Medio | Directo | 2.2 |
| 2.4 | Mascot, celebrations and sounds | Sonnet 5 | Medio | Directo | 2.3 |
| 2.5 | Accessibility and keyboard pass | Sonnet 5 | Medio | Directo | 2.4 |
| 3.1 | Domain schema and migrations | Fable 5.1 | Extra | Plan | 1.5 |
| 3.2 | Repositories and core ports | Opus 5 | Alto | Plan | 3.1 |
| 3.3 | Full-text and hybrid vector search | Opus 5 | Alto | Directo | 3.2 |
| 3.4 | Persistent job queue and worker pool | Opus 5 | Alto | Plan | 3.2 |
| 3.5 | Blob store, backups, settings and secrets | Sonnet 5 | Medio | Directo | 3.2 |
| 4.1 | FSRS-6 scheduler wrapper and regression tests against py-fsrs | Fable 5.1 | Max | Plan | 3.2 |
| 4.2 | Importance levels and per-item desired retention | Opus 5 | Extra | Plan | 4.1 |
| 4.3 | Daily session composer, overload protection, final drill | Opus 5 | Alto | Plan | 4.2 |
| 4.4 | Review screen | Sonnet 5 | Alto | Directo | 4.3, 2.3 |
| 4.5 | Exercise → rating mapping, review logs and basic stats | Opus 5 | Alto | Directo | 4.3 |
| 4.6 | Optimizer, simulator, leeches, bury, load balancer, easy days | Opus 5 | Extra | Plan | 4.5, 3.4 |
| 5.1 | Activity schema (zod per family) and grader utilities | Fable 5.1 | Extra | Plan | 3.1 |
| 5.2 | ActivityHost, type registry, shared components, Storybook | Opus 5 | Alto | Plan | 5.1, 2.3 |
| 5.3 | Families choice, cards, text_input, cloze (renderers + generators stubs) | Sonnet 5 | UltraCode | Directo | 5.2 |
| 5.4 | Families pairs, ordering, categorize, text_mark, disclosure | Sonnet 5 | UltraCode | Directo | 5.2 |
| 5.5 | long_text family with AI grading and "Explain my answer" | Opus 5 | Alto | Directo | 5.2 |
| 5.6 | Session generator: lesson practice and review variety | Opus 5 | Alto | Plan | 5.3, 5.4, 5.5, 4.3 |
| 6.1 | Source library and document parsers (PDF, DOCX, EPUB, PPTX, Markdown/TXT, images) | Sonnet 5 | Alto | Plan | 3.4, 3.5 |
| 6.2 | SourceDoc normalization and structural chunking | Opus 5 | Alto | Directo | 6.1 |
| 6.3 | Embeddings (local + cloud), hybrid retrieval and reranker | Opus 5 | Alto | Directo | 6.2, 3.3 |
| 6.4 | Audio and video ingestion (ffmpeg, local Whisper, keyframes, slide OCR) | Opus 5 | Extra | Plan | 6.2 |
| 6.5 | Web pages and YouTube | Sonnet 5 | Medio | Directo | 6.2, 6.4 |
| 6.6 | PDF/EPUB reader with highlights → memory items | Sonnet 5 | Alto | Plan | 6.1, 4.4 |
| 7.1 | Provider profiles, roles, pricing table and cost log | Opus 5 | Extra | Plan | 3.5 |
| 7.2 | Structured outputs, validation/repair loop, versioned prompt files | Opus 5 | Alto | Directo | 7.1 |
| 7.3 | Batch API and prompt caching | Opus 5 | Alto | Directo | 7.2 |
| 7.4 | Local providers, offline behaviour and fallback policy | Sonnet 5 | Medio | Directo | 7.1 |
| 7.5 | AI settings, keys, budget, usage dashboard and evals | Sonnet 5 | Medio | Directo | 7.1–7.4 |
| 8.1 | Extraction (P1), synthesis (P2) and deterministic sequencing | Fable 5.1 | Max | Plan | 6.3, 7.3 |
| 8.2 | Generation wizard, editable preview and PathSpec freeze | Sonnet 5 | Alto | Directo | 8.1 |
| 8.3 | Lesson expansion (P3–P5) in batch with progress and resume | Opus 5 | Extra | Plan | 8.2, 5.6 |
| 8.4 | QA gates (P6–P8): citations, faithfulness, coverage, dedupe, Bloom variety, judge | Fable 5.1 | Extra | Plan | 8.3 |
| 8.5 | Item bank (P9) and prior-knowledge diagnostic (Elo-lite) | Opus 5 | Extra | Plan | 8.3, 5.6 |
| 8.6 | Remediation (P11), regeneration and path versioning | Opus 5 | Alto | Directo | 8.4, 8.5 |
| 9.1 | Path map and soft unlocking | Sonnet 5 | Alto | Directo | 8.2, 4.3, 2.3 |
| 9.2 | Lesson player: theory and practice | Sonnet 5 | Alto | Plan | 9.1, 5.6, 8.3 |
| 9.3 | Reinforcement and checkpoint nodes → memory flow | Opus 5 | Alto | Directo | 9.2, 4.3, 8.5, 8.6 |
| 9.4 | AI tutor with citations and "Explain my answer" | Opus 5 | Alto | Directo | 7.2, 6.3 |
| 9.5 | Notes editor (Tiptap) with "card from any block" | Opus 5 | Alto | Plan | 4.4, 6.6 |
| 10.1 | Exam scheduler ("study toward date X") and readiness | Opus 5 | Extra | Plan | 4.2, 4.3 |
| 10.2 | Mock exams and blind mode | Sonnet 5 | Alto | Directo | 10.1, 8.5, 5.2 |
| 10.3 | AI grading of open answers (P10) and post-exam analytics → memory | Opus 5 | Alto | Directo | 10.2, 7.2 |
| 10.4 | Study plan and exam notifications | Sonnet 5 | Medio | Directo | 10.1, 13.3 |
| 11.1 | Audio capture, VAD, storage and playback | Sonnet 5 | Alto | Directo | 1.2, 3.5 |
| 11.2 | Azure Pronunciation Assessment and results UI | Opus 5 | Alto | Plan | 11.1, 7.1, 5.2 |
| 11.3 | TTS with cache and listening activities | Sonnet 5 | Medio | Directo | 7.1, 5.2 |
| 11.4 | Accent Lab (target accent coaching, Irish English first) | Opus 5 | Extra | Plan | 11.2, 11.3 |
| 11.5 | STT for answers, dictation, speak activities and text roleplay | Sonnet 5 | Alto | Directo | 11.1, 7.1, 5.6 |
| 12.1 | Image provider and asset pipeline | Sonnet 5 | Medio | Directo | 7.1, 3.5 |
| 12.2 | Diagrams-as-code and image-occlusion editor | Sonnet 5 | Alto | Directo | 12.1, 9.5 |
| 12.3 | Light video explainers (Remotion) and optional generative video | Sonnet 5 | Medio | Directo | 11.3, 12.2 |
| 12.4 | Code sandboxes and code activities | Opus 5 | Alto | Plan | 5.2, 1.2 |
| 13.1 | XP, streaks, goals, quests, achievements and sober mode | Sonnet 5 | Medio | Directo | 4.5, 9.2 |
| 13.2 | Statistics screen (full) | Sonnet 5 | Medio | Directo | 4.5, 10.1 |
| 13.3 | Notifications, tray, reminders and global hotkey | Haiku 4.5 | Bajo | Directo | 4.3, 1.3 |
| 13.4 | Importers and exporters (Anki .apkg, CSV, RemNote, Markdown/Obsidian, full export) | Opus 5 | UltraCode | Plan | 3.2, 4.1, 9.5 |
| 13.5 | Onboarding, settings consolidation and opt-in telemetry | Sonnet 5 | Medio | Directo | 13.1, 13.4, 7.5 |
| 14.1 | Security hardening and audit | Fable 5.1 | UltraCode | Plan | all previous phases |
| 14.2 | Performance and memory pass | Opus 5 | Alto | Plan | 14.1 |
| 14.3 | Code signing, installer and auto-update end-to-end | Sonnet 5 | Alto | Directo | 14.2, 1.4 |
| 14.4 | E2E Playwright suite and beta checklist | Sonnet 5 | UltraCode | Directo | 14.3 |
| 14.5 | macOS build and documentation | Sonnet 5 | Medio | Directo | 14.4 |

**Totals:** Sonnet 5 in 37 sub-phases, Opus 5 in 31, Fable 5.1 in 6, Haiku 4.5 in 2.
Effort: Bajo 2 · Medio 21 · Alto 35 · Extra 11 · Max 2 · UltraCode 5 (5.3, 5.4, 13.4,
14.1, 14.4). 31 sub-phases start in plan mode.

### 10.3 Model and effort mapping to Claude Code

Verified in `code.claude.com/docs` (model-config, workflows, sub-agents, hooks,
best-practices) on 2-Sep-2026:

| Label in prompts.md | Real control | How it is activated | When to use it |
|---|---|---|---|
| **Haiku 4.5** | alias `haiku` → Claude Haiku 4.5 (200K, USD 1/5) | `/model haiku` · `--model haiku` · `model: haiku` in a subagent | Boilerplate, scaffolding, docs, mechanical tests, fan-out of small tasks. Does not accept the effort parameter (it uses fixed extended thinking): the effort labels on its sub-phases are nominal. |
| **Sonnet 5** | alias `sonnet` → Claude Sonnet 5 (1M, USD 2/10) | `/model sonnet`; `sonnet[1m]` for explicit 1M | UI and feature implementation with a clear spec; the workhorse. |
| **Opus 5** | alias `opus` → Claude Opus 5 (1M, USD 5/25) | `/model opus` · `/model opusplan` = Opus in plan mode and Sonnet when executing | Architecture, complex domain logic, delicate integrations, hard bugs, refactors. |
| **Fable 5.1** | alias `fable` → Claude Fable 5.1 (1M, USD 10/50) | `/model fable`; `best` → the most recent Fable (or Opus if unavailable) | Foundational decisions (schema, scheduler, generation pipeline, security audit). It is the slowest and most expensive: reserve it. |
| **Bajo** | `effort: low` | `/effort low` · `--effort low` · `CLAUDE_CODE_EFFORT_LEVEL=low` | Simple, parallelizable tasks; ~50 % fewer tokens. |
| **Medio** | `effort: medium` | `/effort medium` | Routine agentic work with a clear spec. |
| **Alto** (default on most models) | `effort: high` | `/effort high` | Full reasoning; non-trivial implementation. |
| **Extra** (Fable 5.1/5, Opus 5, Sonnet 5, Opus 4.8/4.7) | `effort: xhigh` | `/effort xhigh` | Long-horizon work (30+ min), architectures, migrations. |
| **Max** (unlimited reasoning budget) | `effort: max` | `/effort max` | Frontier problems: the scheduler design, the generation pipeline, the audit. |
| **UltraCode** | ultracode = `xhigh` effort + automatic orchestration of dynamic workflows (dozens of subagents from a script Claude writes) | `/effort ultracode` (session) · `claude --effort ultracode` · `"ultracode": true` in settings · or the keyword `ultracode:` at the start of a prompt (that turn only) | Parallel sweeps: implement 10 renderers at once, audit all IPC handlers, migrate many files, adversarially verify findings. Requires a paid plan with workflows enabled; up to 16 concurrent agents and 1,000 per run; size guide in `/config` (small < 5, medium < 15, large < 50). It is expensive: try it first on a slice. |

**Notes**

- Effort can be fixed per sub-agent and per skill in the frontmatter (`effort: high`);
  `/effort auto` clears the saved level.
- `effortLevel` and `modelSettings` in `settings.json` set per-model defaults;
  `CLAUDE_CODE_EFFORT_LEVEL` does not accept `ultracode`.
- The keyword `ultracode` in the prompt only triggers a workflow if you type it yourself
  in the interactive prompt (not in `-p` and not in scheduled tasks).

### 10.4 How to use prompts.md

1. **Phase 0 first, once only.** Creates the repo, `CLAUDE.md`,
   `.claude/settings.json` with permissions and hooks (typecheck + tests at the end of
   each turn), subagents (reviewer, tester, security), project skills, and copies the key
   sections of this PDF to `docs/spec/` as the source of truth for Claude.
2. **One sub-phase = one clean session.** `/clear`, `/model` and `/effort` per the
   header, paste the whole prompt. Each prompt is self-contained: context, objective,
   deliverables, acceptance criteria, verification commands and what NOT to do.
3. **Explore → Plan → Code → Commit.** The prompts of large sub-phases ask to enter plan
   mode (Shift+Tab) and approve the plan (Ctrl+G to edit it) before implementing. If you
   can describe the diff in one sentence, skip the plan.
4. **Always verify.** Every prompt ends with "run typecheck + tests + lint; show the
   evidence". For UI sub-phases, a screenshot with Playwright; the Stop hook blocks the
   end of the turn if the tests fail (Claude Code ignores it after 8 consecutive blocks).
5. **Adversarial review before closing the phase.** "Use a subagent to review the diff
   against `docs/spec/…`; report gaps, not style"; or `/code-review` for bugs. Chasing
   every finding leads to over-engineering: only what affects correctness or requirements.
6. **Clean context.** If you corrected the same thing twice, `/clear` and a better
   prompt. `/compact <instructions>` in long sessions; `/btw` for questions that must not
   enter the context; `/rewind` to return to a checkpoint.
7. **Parallelize with worktrees.** Independent phases (F11, F12, F13) in separate
   sessions with `--worktree`; Writer/Reviewer pattern with two sessions for critical
   code.

### 10.5 Claude Code configuration left ready by phase 0

| Piece | Content |
|---|---|
| `CLAUDE.md` | Short and concrete: commands (`pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm e2e`), conventions (ESM, TypeScript strict, Biome, package names, where each thing lives), domain rules Claude cannot infer (FSRS fields 1:1 with `ts-fsrs`, UUIDv7 ids, soft deletes, "core does not import Electron"), gotchas (`better-sqlite3` only in main, CSP, IPC via contract), commit etiquette, and imported `@docs/spec/*.md`. It is pruned when Claude ignores rules: if the file is long, the rules get lost. |
| `.claude/settings.json` | `permissions.allow` for `pnpm test/typecheck/lint/build`, `git commit`, `git status/diff`; `deny` for recursive force-delete commands, `git push --force`, and writing in `migrations/` without review; hooks: `PostToolUse` (matcher `Edit|Write`) → `biome check --write` of the file; `Stop` → `pnpm typecheck && pnpm test --changed` (exit 2 blocks); `PreToolUse` (Bash) → script that denies destructive commands. |
| `.claude/agents/` | `reviewer` (model: opus, tools: Read/Grep/Glob/Bash; reviews the diff against the spec), `tester` (model: sonnet; writes and runs tests), `security-reviewer` (model: opus; IPC, CSP, keys, injection), `explorer` (model: haiku; cheap searches). Frontmatter: `name, description, tools, model, effort, permissionMode, maxTurns`. |
| `.claude/skills/` | `fsrs-domain` (scheduler rules), `activity-type` (how to add a type: file + prompt + fixtures + story), `ipc-channel` (how to add a channel), `release` (release checklist with `disable-model-invocation: true`). |
| MCP | GitHub (issues/PRs) and, optionally, Playwright for app screenshots; Context7 or similar for up-to-date library documentation (`claude mcp add`). |
| `docs/spec/` | Extracts of this PDF in Markdown: decisions, data schema, FSRS formulas, importance table, activity taxonomy and payload families, generation pipeline with prompts P1–P11, provider matrix, UX design. It is what the prompts reference with `@docs/spec/…`. |

---

## Appendix A. Competitive landscape (section 3)

Verified inventory (help centers, changelogs and official pages, 1-Sep-2026) of RemNote,
SuperMemo, Anki, Duolingo, Gemini Notebook (ex NotebookLM) and some 40 modern apps.

### A.1 RemNote 1.28 — the closest competitor

RemNote (v1.28.9 of 31-Aug-2026; Free / Pro USD 8 / Pro+AI USD 18 per month plans) is
today "80 % of the vision" on the notes + cards + AI + exams axis.

| Area | Verified features |
|---|---|
| Editor and KB | Outliner of "Rems" with references and backlinks, portals (embedding a block elsewhere), search portals with a query builder, tags and a concept/descriptor framework, templates, aliases, tables V2 with AI Autofill and cards per cell, LaTeX with cloze, code blocks, Daily Documents, tabs and multi-window (1.28), infinite canvas and handwritten documents, web clipper. |
| Sources | PDF Reader with linked highlights, web annotation, YouTube Annotator, Lecture Recorder with on-device transcription (iOS), image OCR, import from Anki/Quizlet/Markdown/CSV, export to Markdown/PDF/Anki/CSV. |
| Flashcards | Basic (`>`), reverse (`<`), bidirectional (`>>`), concept (`::`), descriptor (`;`), cloze, multi-line list/set, multiple choice (+ "Multiple-Choice Learn Mode"), type-in with fuzzy and AI Grading, image occlusion, card clusters, hints, extra detail, Edit Later, Flashcard Insights ("Why True", "Near Misses"), "Cards to Learn" queue, TTS in the queue, card table. |
| Scheduler | SM-2 (Anki-like) and FSRS v6 (beta) with learning steps and auto-train; 4 buttons + Skip; separate daily goal and streak goal ("Forgot" does not count); streak freezes (1 every 6 days, bank of 2); per-document priorities (Exam / Currently Studying / Maintaining / Paused). |
| Exam Scheduler V2 | 10-step wizard; Learning / Catch-up / Final review periods; "Ensure Mastery" (2 consecutive correct); calculated daily goal; lateness warnings; priority of the exam's cards in the queue; presets (e.g. MCAT). |
| AI | AI Tutor with clickable citations and screen reading; Guided Learn Mode (PDF/video/audio → baseline → 5–10 min sections → summary + flashcards + quizzes → Mastery Tracker → Study Guide); AI grading; model selection by cost; credits per plan; local MCP server (beta). |
| Platform | Unlimited sync + offline; plugins with a React SDK and marketplace; share/publish; icon badge with today's cards; resumable update. |

**What RemNote does NOT have (our space):** gamified path with theory+practice lessons;
interactive exercises beyond MCQ/cloze/type-in; per-item importance that modulates the
target retention; overload tools (postpone, mercy, final drill); multi-AI by modality with
BYOK and local models; voice/pronunciation; LatAm exam templates.

### A.2 SuperMemo 20 — the advanced ideas nobody copies

SuperMemo 20 (20.00.31, June 2026; the SM-20 algorithm published in February 2026,
adjusted by machine learning with ~40 parameters and an "Algorithm Arena" that compares
SM-2…SM-20 and FSRS over your data) remains the reference for:

- Priority queue 0–100 % with auto-sort and auto-postpone that sacrifices the least
  important first.
- Mercy (redistribute the backlog), Postpone, Advance, Add to outstanding.
- Final drill (repeat anything graded < Good until passed in the same session).
- Subset review, search & review and neural review (activation propagating through
  conceptual links).
- Incremental reading/video with extracts and clozes; native incremental PDF.
- Plan (daily agenda), Tasklist, Sleep Chart (two-component alertness model).
- Analysis with 400 forgetting curves, load simulation over years.

`supermemo.com` adds courses, Live (spoken dialogue with AI, 15 min/day), MemoChat and
card generation with ChatGPT. Weakness: UX from another era.

### A.3 Anki — the portability standard

Anki (25.09.x; 26.05 in beta with a terminal-free installer) defines the interchange
format (`.apkg`) and the reference implementation of FSRS: desired retention 0.70–0.97 per
preset and per deck, optimize, health check, load simulator, easy days, load balancer,
sibling bury, leeches (8 lapses), custom study and filtered decks (review forgotten, review
ahead, by tag/state), native image occlusion, nested cloze, complete statistics (Future
Due, Calendar, Card Stability/Difficulty/Retrievability, True Retention).

The gap with its add-ons is a requirements list for us: heatmap,
postpone/advance/flatten/holidays (FSRS Helper), multi-service TTS (HyperTTS), Speed
Focus, AnkiConnect (local API), leaderboard.

### A.4 Duolingo — the motivation reference

A single visible path (Sections → Units → Levels → Lessons with Guidebook), micro-lessons
with immediate feedback, Stories, DuoRadio, Adventures, Practice Hub (Mistakes, Words,
Listening, Speaking), placement test, Legendary, Duolingo Score 0–160 aligned to CEFR;
Max: Explain My Answer, Roleplay, Video Call with Lily; Math, Music and Chess courses
(with Game Review, Aug-2026).

Gamification: streak + freezes + friend streaks + Streak Society, XP and boosts, 10
leagues, gems, daily/friend/monthly quests, badges, avatars, timed challenges (Match
Madness), notifications optimized with bandits.

**Public evidence:** leagues raised learning time by 17 %; the "streak saver" notification
was the biggest retention jump; users with a streak ≥ 7 days went from ~17 % to >50 % of
DAU; a Gardenscapes-style "moves" counter moved nothing; hearts were replaced by "Energy"
in 2025 after years of criticism.

**What Duolingo does not do:** own content, transparent scheduler, serious desktop.

### A.5 Gemini Notebook (ex NotebookLM) and the "upload and generate" wave

Renamed on 16-Jul-2026, it generates loose artifacts from sources (chat with citations,
Audio/Video Overviews, mind maps, reports, flashcards and quizzes with difficulty and
"Explain", infographics, slide decks, data tables, Deep Research) and a Socratic "Learning
Guide" mode; per-plan limits (50/100/300/500/600 sources per notebook; 500,000 words or
200 MB per source; YouTube transcript only). It does not produce a sequenced curriculum
and has no scheduler.

The same applies to Turbo, Knowt, Mindgrasp, StudyFetch, Gizmo, Quizlet Magic Notes: notes
+ cards + quiz + podcast + tutor, with repeated complaints of shallow content, repetitive
quizzes and factual errors. Oboe (a complete course from a prompt) repeats the quiz
questions in the final exam.

The strongest evidence in favour of our approach is **Learn Your Way** (Google Research,
2025): source → immersive text with embedded questions, per-section quizzes, slides +
audio, mind map; RCT with 60 students: +9 % immediate and 78 % vs 67 % retention at 3–5
days.

### A.6 Languages, PKM and reading: what to take from each

- **ELSA / Speak / Praktika / BoldVoice:** per-phoneme feedback with coloured words,
  roleplay with avatars, configurable feedback tone (soft/balanced/strict), post-conversation
  transcript, accent choice, "accent strength" with proprietary models (BoldVoice). They
  define the voice standard.
- **Migaku / LingQ / Readlang / Clozemaster / Lingvist:** click-to-define on real content,
  one-click cards with sentence + audio + capture, "known words" and comprehension score,
  cloze by frequency, custom decks from any text.
- **Obsidian / Logseq / Heptabase / Tana:** local Markdown, backlinks, canvas, command
  palette, plugins, version history, CLI/MCP for agents; the Obsidian Spaced Repetition
  plugin fixes the import syntax (`::`, `==cloze==`, `{{1::…}}`).
- **Readwise / Reader / Matter / Zotero:** highlights → daily review with mastery,
  Ghostreader, TTS, MCP server; Zotero for bibliography and academic annotation.
- **Brilliant / Khan Academy:** interactive manipulatives in the explanation; mastery per
  skill (Familiar → Proficient → Mastered) with unit tests and course challenges;
  Khanmigo Socratic mode and its teacher tools.

### A.7 Comparison matrix (summary)

✔ native · ◐ partial or via add-on · ✘ no · ? **(unverified)**

| Feature | Retenia (plan) | RemNote | SuperMemo 20 | Anki | Duolingo | Gemini Notebook | Kinnu | Quizlet |
|---|---|---|---|---|---|---|---|---|
| Duolingo-style linear paths | ✔ generated from sources | ◐ Guided Learn (no path) | ✘ | ✘ | ✔ (Duolingo's own content) | ✘ | ✔ (curated) | ✘ |
| Own sources → content | ✔ PDF/video/web/audio/img | ✔ PDF/video/audio | ◐ incremental reading | ✘ | ✘ | ✔ (loose artifacts) | ✘ | ◐ Magic Notes |
| Memory algorithm | FSRS-6 + importance | FSRS-6 (beta) / SM-2 | SM-20 (+Arena) | FSRS-6 / SM-2 | HLR (internal) | ✘ (Got it / Missed it) | proprietary | logistic regression (Learn) |
| Priority / per-item importance | ✔ 5 levels → DR, order, postpone | ◐ per document | ✔ 0–100 % | ✘ | ✘ | ✘ | ✘ | ✘ |
| Dated exam | ✔ layer over FSRS + mock exams | ✔ Exam Scheduler V2 | ◐ subset + final drill | ◐ filtered decks | ✘ | ✘ | ✘ | ◐ Learn with a date |
| Scheduled interactive exercises | ✔ 89 types with rating 1–4 | ◐ MCQ / type-in | ◐ spelling/MCQ | ◐ type-in | ✔ (not SRS-scheduled) | ◐ quizzes | ◐ MCQ | ◐ Learn/Test/Match |
| Postpone / Mercy / final drill | ✔ built in | ✘ | ✔ | ◐ add-on | ✘ | ✘ | ✘ | ✘ |
| Per-phoneme pronunciation | ✔ Azure + Accent Lab | ✘ | ◐ (supermemo.com STT) | ✘ | ◐ ASR pass/fail | ✘ | ✘ | ✘ |
| Full gamification | ✔ + sober mode | ◐ streaks/goals | ✘ | ◐ add-ons | ✔ | ✘ | ◐ | ◐ |
| Local-first + BYOK + local AI | ✔ | ◐ offline; own AI | ✔ local (no AI) | ✔ local (no AI) | ✘ | ✘ | ✘ | ✘ |
| Anki import/export | ✔ | ✔ | ◐ | ✔ (it is the format) | ✘ | ◐ CSV | ✘ | ◐ |

### A.8 Fifteen differentiators nobody has combined

1. Duolingo path generated from your sources + transparent FSRS scheduler.
2. Interactive exercises (ordering, categorizing, labelling, code-fill, dictation…) with
   their own D/S/R state, rescheduled as cards.
3. Importance as a first-class citizen (SuperMemo inheritance) with a 4-level UI and an
   explanation of the cost in reviews.
4. Multi-source scheduled exams with mock exams in the real format and a Learning /
   Catch-up / Final review plan, in Spanish and with LatAm templates (ICFES, ENEM, EXANI,
   PAES, public-service exams) in V2.
5. Serious local-first desktop + multi-AI with BYOK and local models.
6. Multi-AI by modality (text, image, TTS, STT/pronunciation) with local cache and
   visible cost.
7. Postpone / Advance / Flatten / holidays / Easy Days / Final Drill built in, with an
   overload assistant.
8. Gamification by profile and with evidence: arcade mode and sober mode; never punish
   errors; substance metrics alongside vanity metrics.
9. Tutor with longitudinal memory of the learner (what they forget, when, at what hour
   they perform) that creates remedial practice.
10. Neural/semantic review on failure: review conceptual neighbours in the graph.
11. Socratic mode + knowledge checks inside the theory, connected to the scheduler.
12. Performance by hour → schedule recommendation (and, optionally, sleep logging).
13. Local MCP server/CLI to use your favourite assistant over your study base.
14. B2B (future) with real retention reports, not just "completed the course".
15. Full voice in LatAm Spanish: neural TTS with regional accents + pronunciation in 6
    languages integrated into the same general study product.
