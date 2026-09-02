Source: Retenia research PDF v1.0 (Sep 2026), section 15

# Glossary and sources

Terms that appear in the research document and in `prompts.md`, plus the primary sources
consulted (all verified by direct access on 1–2 September 2026; those that returned an error
are indicated in their section).

## Table of contents

- [1. Glossary](#1-glossary)
- [2. Main sources](#2-main-sources)

---

## 1. Glossary

| Term | Definition |
|---|---|
| **Activity engine** | The package that renders, grades and records any activity type from a JSON with `type` and `payload.family`. |
| **Batch API** | Asynchronous mode of Anthropic/OpenAI/Gemini with a 50 % discount; results typically in under an hour, maximum 24 h. |
| **Blind solve** | A validation in which a second model solves the item without seeing the key; if it disagrees, the item is flagged for review. |
| **Blueprint** | An exam's table of specifications: topic × Bloom level × difficulty with weights. |
| **BYOK** | Bring Your Own Key: the user loads their own API keys. |
| **Contextual retrieval** | An Anthropic technique: prepend to each chunk a short LLM-generated context to improve retrieval. |
| **Desired retention (DR)** | The target recall probability with which FSRS schedules the next review (0.90 by default). |
| **DSR** | Difficulty, Stability, Retrievability: the three variables of the FSRS memory model. |
| **Elo-lite** | A per-module ability estimator inspired by Elo (Pelánek 2016), used in the diagnostic. |
| **Final drill** | Repeating at the end of the session everything graded below Good until it is passed (SuperMemo). |
| **FSRS-6** | Free Spaced Repetition Scheduler, version 6: an open algorithm with 21 optimizable parameters. |
| **Fuzz** | A small randomization of the interval so that cards created together do not become due together. |
| **Importancia** (importance) | A per-item level (Urgente, Alta, Normal, Mantenimiento, Pausado) that fixes DR, the interval cap, the order and the postpone policy. |
| **Item bank** | A bank of items with metadata (module, Bloom, difficulty, usage) from which diagnostics, reinforcements and exams are sampled. |
| **Knowledge graph** | A graph of concepts with prerequisite and relation edges, built during the path's synthesis. |
| **Leech** | A repeatedly forgotten card (8 lapses in Anki, 4 in RemNote) that is worth rewriting or suspending. |
| **Load balancer** | Within the fuzz range, choosing the day with fewest reviews. |
| **Mercy / Postpone** | Redistributing or deferring overdue reviews while protecting what matters (SuperMemo). |
| **Misconception** | A frequent conceptual error, extracted by the AI and used for distractors and remediation. |
| **Need to Learn** | The queue of candidate items not yet scheduled (RemNote). |
| **Outbox** | A table that records local changes pending synchronization (empty in v1). |
| **Parallel forms** | Two equivalent versions of an exam (A/B) that share no items. |
| **PathSpec** | The frozen specification of a path (order and ids), versioned. |
| **Pronunciation Assessment (PA)** | Azure's service that scores accuracy, fluency, completeness and prosody per phoneme/word. |
| **Readiness** | Estimated preparation for an exam: `Σ R` on the exam day, weighted by blueprint. |
| **Retrievability (R)** | The probability of recalling an item now. |
| **RRF** | Reciprocal Rank Fusion: combining BM25 and vector rankings. |
| **Stability (S)** | The interval after which R falls to 0.9. |
| **Structured outputs** | JSON output guaranteed by a schema (Anthropic, OpenAI, Gemini). |
| **True retention** | The real percentage of correct answers on the first review of the day for mature cards. |
| **UltraCode** | A Claude Code setting: xhigh effort + automatic orchestration of workflows with many subagents. |
| **`utilityProcess`** | An Electron child process with Node for heavy work outside main. |
| **xAPI** | The learning-event format (verb, object, result) used by H5P and SCORM/cmi5. |

## 2. Main sources

### Spaced repetition and learning science

- https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- https://expertium.github.io/Algorithm.html
- https://github.com/open-spaced-repetition/ts-fsrs
- https://github.com/open-spaced-repetition/fsrs-rs
- https://github.com/open-spaced-repetition/srs-benchmark
- https://expertium.github.io/Benchmark.html
- https://github.com/open-spaced-repetition/fsrs-vs-sm17
- https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention
- https://github.com/open-spaced-repetition/fsrs4anki-helper
- https://expertium.github.io/Retention.html
- https://docs.ankiweb.net/deck-options.html
- https://docs.ankiweb.net/filtered-decks.html
- https://docs.ankiweb.net/leeches.html
- https://docs.ankiweb.net/stats.html
- https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html
- https://github.com/ankitects/anki/releases
- https://supermemo.guru/wiki/Algorithm_SM-17
- https://supermemo.guru/wiki/Algorithm_SM-20
- https://supermemo.guru/wiki/Two_component_model_of_memory
- https://supermemo.guru/wiki/Final_drill
- https://super-memory.com/help/priority.htm
- https://super-memory.com/help/postpone.htm
- https://supermemo.store/products/supermemo-20-upgrade
- https://www.supermemo.com/en/blog/twenty-rules-of-formulating-knowledge
- https://help.remnote.com/en/articles/9102040-understanding-the-exam-scheduler
- https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm
- https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards
- https://help.remnote.com/en/articles/15724936-guided-learn-mode
- https://help.remnote.com/en/articles/10103884-ai-tutor-chat
- https://feedback.remnote.com/rss/changelog.xml
- https://www.remnote.com/pricing
- https://github.com/fasiha/ebisu
- https://aclanthology.org/P16-1174.pdf (HLR)
- https://mochi.cards/docs/reviewing/fsrs/
- https://www.brainscape.com/academy/confidence-based-repetition-definition/
- https://www.aft.org/ae/fall2013/dunlosky
- https://bjorklab.psych.ucla.edu/research/
- https://gwern.net/spaced-repetition
- https://www.learningscientists.org/downloadable-materials
- https://www.kinnu.xyz/blog/research/what-we-found-in-our-10000-person-learning-experiments/

### Interactive activities

- https://www.articulatesupport.com/article/Storyline-360-Adding-Form-Based-Questions
- https://www.articulatesupport.com/article/Storyline-360-Adding-Freeform-Questions
- https://help.rise.com/en/articles/2059261-choose-lesson-and-block-types
- https://helpx.adobe.com/captivate/classic/set-question-slides.html
- https://helpx.adobe.com/captivate/classic/whats-new.html
- https://helpx.adobe.com/captivate/help/create-interactions.html
- https://blog.lilybiri.com/tips-learning-interactions
- https://docs.moodle.org/en/Question_types
- https://docs.moodle.org/en/Third-party_question_types
- https://docs.moodle.org/en/Activities
- https://docs.moodle.org/en/Game_module
- https://docs.moodle.org/en/CodeRunner_question_type
- https://docs.stack-assessment.org/en/
- https://moodle.org/plugins/mod_vpl
- https://moodle.org/plugins/block_xp
- https://moodle.org/plugins/mod_minilesson
- https://h5p.org/content-types-and-applications
- https://h5p.org/interactive-video
- https://h5p.org/branching-scenario
- https://h5p.org/licensing
- https://github.com/tunapanda/h5p-standalone
- https://github.com/Lumieducation/H5P-Nodejs-library
- https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain
- https://blog.duolingo.com/large-language-model-duolingo-lessons/
- https://blog.duolingo.com/new-duolingo-home-screen-design
- https://blog.duolingo.com/duolingo-max
- https://blog.duolingo.com/duolingo-score/
- https://blog.duolingo.com/chess-course
- https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth
- https://github.com/Khan/perseus
- https://wordwall.net/features
- https://www.educaplay.com/
- https://learningapps.org/createApp.php
- https://elsaspeak.com/en/
- https://www.speak.com/
- https://praktika.ai/
- https://www.boldvoice.com/

### AI paths and instructional design

- https://support.google.com/notebooklm/answer/16213268
- https://support.google.com/notebooklm/answer/16215270
- https://support.google.com/notebooklm/answer/16958963
- https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/
- https://research.google/blog/learn-your-way-reimagining-textbooks-with-generative-ai/
- https://arxiv.org/abs/2412.16429 (LearnLM)
- https://openai.com/index/chatgpt-study-mode/
- https://blog.khanacademy.org/new-ai-tools-bring-interactive-diagrams-and-targeted-practice-thanks-to-khan-academys-partnership-with-google-org/
- https://www.anthropic.com/engineering/contextual-retrieval
- https://arxiv.org/abs/2307.15337 (Skeleton-of-Thought)
- https://arxiv.org/abs/2303.17651 (Self-Refine)
- https://arxiv.org/abs/2309.11495 (CoVe)
- https://arxiv.org/abs/2305.14251 (FActScore)
- https://arxiv.org/abs/2411.15594 (LLM-as-a-judge)
- https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf
- https://www.aleks.com/about_aleks/knowledge_space_theory
- https://aclanthology.org/2020.tacl-1.17/ (DET)
- https://arxiv.org/abs/2405.02985 (Henkel, grading)
- https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0290691 (Cheung, MCQ)
- https://arxiv.org/abs/2307.16338 (distractors)
- https://arxiv.org/html/2506.22303v1 (DLELP)
- https://arxiv.org/abs/2105.15106 (knowledge tracing survey)
- https://www.niu.edu/citl/resources/guides/instructional-guide/gagnes-nine-events-of-instruction.shtml
- https://primmportal.com/
- https://www.nbme.org/item-writing-guide
- https://www.coe.int/en/web/common-european-framework-reference-languages/table-1-cefr-3.3-common-reference-levels-global-scale

### AI providers (verified prices)

- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/models/overview
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://platform.claude.com/docs/en/build-with-claude/batch-processing
- https://platform.claude.com/docs/en/build-with-claude/pdf-support
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://platform.claude.com/docs/en/api/rate-limits
- https://www.anthropic.com/supported-countries
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/text-to-speech
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/tokens
- https://ai.google.dev/gemini-api/docs/document-processing
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/audio
- https://ai.google.dev/gemini-api/docs/terms
- https://ai.google.dev/gemini-api/docs/available-regions
- https://api-docs.deepseek.com/news/news260813
- https://platform.kimi.ai/docs/pricing/chat
- https://www.alibabacloud.com/help/en/model-studio/model-pricing
- https://docs.z.ai/guides/overview/pricing
- https://x.ai/api
- https://mistral.ai/pricing/api/
- https://openrouter.ai/docs/faq
- https://docs.fireworks.ai/serverless/pricing
- https://www.together.ai/pricing
- https://arena.ai/leaderboard/text
- https://artificialanalysis.ai/leaderboards/models
- https://ai-sdk.dev/providers/ai-sdk-providers
- https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
- https://vercel.com/changelog/ai-sdk-7
- https://docs.ollama.com/api/openai-compatibility
- https://lmstudio.ai/docs/app/api/endpoints/openai
- https://ollama.com/library

### Voice

- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool
- https://prices.azure.com/api/retail/prices (Speech, eastus)
- https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
- https://github.com/microsoft/cognitive-services-speech-sdk-js
- https://www.speechace.com/api-plans/
- https://www.speechsuper.com/pricing.html
- https://elsaspeak.com/en/elsa-api/
- https://docs.languageconfidence.ai/
- https://accent-strength.boldvoice.com/
- https://arxiv.org/html/2606.15325 (audio LLMs and pronunciation)
- https://arxiv.org/html/2506.02080v2 (GOP)
- https://deepgram.com/pricing
- https://www.assemblyai.com/pricing
- https://elevenlabs.io/pricing/api
- https://elevenlabs.io/docs/overview/models
- https://cloud.google.com/text-to-speech/pricing
- https://aws.amazon.com/polly/pricing/
- https://console.groq.com/docs/speech-to-text
- https://github.com/k2-fsa/sherpa-onnx
- https://github.com/ggml-org/whisper.cpp
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/m-bain/whisperX
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- https://huggingface.co/hexgrad/Kokoro-82M
- https://github.com/resemble-ai/chatterbox
- https://github.com/ricky0123/vad
- https://github.com/ianprime0509/pitchy
- https://github.com/pipecat-ai/pipecat
- https://livekit.com/pricing

### Image, video, embeddings, parsing

- https://blog.google/innovation-and-ai/technology/ai/nano-banana-2/
- https://ai.google.dev/gemini-api/docs/imagen
- https://docs.bfl.ai/quick_start/pricing
- https://www.recraft.ai/pricing?tab=api
- https://docs.x.ai/developers/models/grok-imagine-image
- https://vibedex.ai/blog/best-ai-text-rendering-2026
- https://pricepertoken.com/image
- https://mermaid.js.org/
- https://github.com/excalidraw/excalidraw
- https://tldraw.dev/legal/tldraw-license
- https://www.remotion.dev/docs/license
- https://cloud.google.com/vertex-ai/generative-ai/pricing (Veo)
- https://fal.ai/models (Kling, Hailuo, Seedream)
- https://docs.voyageai.com/docs/pricing
- https://developers.openai.com/api/docs/guides/embeddings
- https://cohere.com/pricing
- https://github.com/asg017/sqlite-vec
- https://lancedb.github.io/lancedb/
- https://huggingface.co/blog/embeddinggemma
- https://github.com/huggingface/transformers.js
- https://mistral.ai/pricing (OCR)
- https://www.llamaindex.ai/llamaparse
- https://docs.datalab.to/
- https://github.com/docling-project/docling
- https://github.com/PaddlePaddle/PaddleOCR
- https://github.com/naptha/tesseract.js
- https://github.com/kepano/defuddle
- https://jina.ai/reader/
- https://www.firecrawl.dev/pricing
- https://www.youtube.com/static?template=terms
- https://pyodide.org/en/stable/

### Desktop stack

- https://releases.electronjs.org/
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/protocol
- https://www.electronjs.org/docs/latest/api/utility-process
- https://www.electronjs.org/docs/latest/api/safe-storage
- https://electron-vite.org/blog/
- https://github.com/electron-userland/electron-builder/releases
- https://www.electron.build/code-signing-win.html
- https://learn.microsoft.com/en-us/azure/trusted-signing/quickstart
- https://www.sslmentor.com/certum/certumcodecloudindividual
- https://www.ssl.com/guide/esigner-pricing-for-code-signing/
- https://www.react.dev/blog/2025/10/01/react-19-2
- https://ui.shadcn.com/docs/changelog
- https://motion.dev/docs/react-upgrade-guide
- https://tiptap.dev/docs/editor/getting-started/overview
- https://www.blocknotejs.org/pricing
- https://www.embedpdf.com/
- https://github.com/johnfactotum/foliate-js
- https://github.com/vidstack/player
- https://wavesurfer.xyz/docs/plugins/record/
- https://github.com/WiseLibs/better-sqlite3/releases
- https://orm.drizzle.team/docs/sqlite/latest-releases
- https://docs.powersync.com/client-sdk-references/node
- https://www.evolu.dev/
- https://github.com/vlcn-io/cr-sqlite
- https://blog.pyodide.org/posts/314-release/
- https://webcontainers.io/enterprise
- https://github.com/laverdet/isolated-vm
- https://eikowagenknecht.com/posts/understanding-the-anki-apkg-format/
- https://help.remnote.com/en/articles/7898019-exporting-notes
- https://www.stephenmwangi.com/obsidian-spaced-repetition/flashcards/cloze-cards/
- https://www.infoq.com/news/2026/08/typescript-7-released/
- https://docs.sentry.io/platforms/javascript/guides/electron/
- https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- https://www.electronjs.org/docs/latest/tutorial/accessibility

### Claude Code

- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/permission-modes
