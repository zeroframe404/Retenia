Source: Retenia research PDF v1.0 (Sep 2026), section 12

# Master feature catalogue

125 candidate features grouped by module, each with a phase tag (**MVP** necessary to
validate · **V1** first year · **V2** consolidation · **Later** vision) and where the idea is
borrowed from. The `prompts.md` phases implement MVP and V1; V2 and Later remain designed in
the schema.

Where a feature is split across phases, the split is transcribed as it appears in the source
(e.g. "MVP (Anki/CSV) · V1 rest").

## Table of contents

- [1 · Sources and ingestion (1–12)](#1--sources-and-ingestion-112)
- [2 · Path generation (13–20)](#2--path-generation-1320)
- [3 · Lessons and theory (21–28)](#3--lessons-and-theory-2128)
- [4 · Practice and activities (29–36)](#4--practice-and-activities-2936)
- [5 · Memory and scheduling (37–52)](#5--memory-and-scheduling-3752)
- [6 · Exams (53–59)](#6--exams-5359)
- [7 · Languages and speech (60–65)](#7--languages-and-speech-6065)
- [8 · Notes and knowledge base (66–74)](#8--notes-and-knowledge-base-6674)
- [9 · AI tutor / chat (75–81)](#9--ai-tutor--chat-7581)
- [10 · Multimedia generation (82–87)](#10--multimedia-generation-8287)
- [11 · Gamification (88–99)](#11--gamification-8899)
- [12 · Statistics (100–105)](#12--statistics-100105)
- [13 · Import / export (106–110)](#13--import--export-106110)
- [14 · Settings and platform (111–120)](#14--settings-and-platform-111120)
- [15 · Commercial (later) (121–125)](#15--commercial-later-121125)

---

## 1 · Sources and ingestion (1–12)

| # | Feature | Tag | Source |
|---|---|---|---|
| 1 | Import PDF, DOCX, PPTX, Markdown, TXT, EPUB with structure (titles, chapters) | MVP | RemNote, Gemini Notebook, Mindgrasp |
| 2 | Paste text/URL and a browser web clipper with clean reading | MVP / V1 | RemNote, Recall, Readwise |
| 3 | YouTube / local video with transcription and time-based annotation | V1 | RemNote YouTube Annotator, Knowt, LingQ |
| 4 | Class recording (Lecture Recorder) with local transcription and a link to slides | V1 | RemNote, Knowt, Turbo |
| 5 | OCR of images, screenshots and handwritten notes | V1 | RemNote Image-to-Text, Quizlet Magic Notes |
| 6 | Import highlights from Kindle/Readwise/Zotero and bibliographies | V2 | Readwise, Heptabase, Zotero |
| 7 | Import Anki (`.apkg`), Quizlet, CSV/Excel, Markdown/Obsidian/Notion | MVP (Anki/CSV) · V1 rest | Anki, Traverse, Knowt |
| 8 | Source library with metadata, tags, folders and collections per exam | MVP | Zotero, RemNote |
| 9 | Integrated PDF/web reader with highlights → notes/cards linked to the page | V1 | RemNote Reader, Zotero |
| 10 | Incremental reading: extracts, prioritized reading queue and read-points | V2 | SuperMemo |
| 11 | Automatic detection of exam-style questions inside the source | V1 | RemNote |
| 12 | Global quick-capture (system hotkey) into an inbox | V1 | Obsidian/RemNote clippers |

## 2 · Path generation (13–20)

| # | Feature | Tag | Source |
|---|---|---|---|
| 13 | Duolingo-style path: Sections → Modules → Lessons generated from the sources with objectives and prerequisites | MVP | Duolingo, RemNote Guided Learn, Kinnu |
| 14 | Baseline / placement per module that skips known content | MVP -lite / V1 | RemNote, Lingvist, Duolingo, Sana |
| 15 | Personalization by goal, exam date, daily time and level | MVP | RemNote Exam Scheduler, StudyFetch, Speak |
| 16 | "Customize topics": include/exclude/skip sections; regenerate; generate the next sections progressively | V1 | RemNote |
| 17 | Visual map of the path (graph of concepts and dependencies) | V2 | Traverse, Heptabase, Kinnu |
| 18 | Guidebook per module (theory summary + key vocabulary) | MVP | Duolingo Guidebook, RemNote Study Guide |
| 19 | Pre-made / community paths and a marketplace of verified paths | Later | Brainscape, SuperMemo.com, Anki shared decks |
| 20 | Simultaneous multi-path with a "daily mix" prioritized by the nearest exam | V1 | Duolingo, RemNote |

## 3 · Lessons and theory (21–28)

| # | Feature | Tag | Source |
|---|---|---|---|
| 21 | Theory page per lesson with a summary, images from the source, clickable key terms | MVP | RemNote Learn PDF |
| 22 | "Explain it another way / simpler / with an example / with an analogy" in one click | MVP | Ghostreader, Explain My Answer |
| 23 | Citations to the source (page/timestamp) on every claim | MVP | Gemini Notebook, RemNote AI Tutor |
| 24 | Consolidated Study Guide (concepts, facts, processes, comparisons, common errors, exam traps) | V1 | RemNote |
| 25 | Audio overview / podcast of the lesson and TTS of the theory | V1 | Gemini Notebook, Knowt Kai, StudyFetch |
| 26 | Generated explainer video / infographic / mind map | V2 / Later | StudyFetch, Gemini Notebook |
| 27 | Socratic mode: the AI asks before explaining; knowledge checks inside the theory | V1 | ChatGPT Study Mode, Khanmigo, Brilliant Koji |
| 28 | User notes in the lesson margin, linkable to the knowledge base | MVP | Coursera notes, RemNote |

## 4 · Practice and activities (29–36)

| # | Feature | Tag | Source |
|---|---|---|---|
| 29 | Exercise catalogue (98 types; 21 in the MVP): MCQ with explanation, T/F, cloze, matching, ordering, categorizing, short answer with AI grading, dictation, speaking, label a diagram, table, timeline, code-fill… | MVP / V1 | Duolingo, Quizlet, Knowt, RemNote, Storyline, H5P |
| 30 | "From your error" exercises: targeted remedial practice | V1 | Speak, Duolingo Mistakes, Brilliant |
| 31 | Study mode vs Test mode per activity (immediate vs deferred feedback) | MVP | RemNote quizzes |
| 32 | Adaptive difficulty inside the session (harder on a correct answer, scaffolding on a failure) | V1 | Brilliant, Quizlet Learn |
| 33 | MCQ → open scaffolding: first exposure as MCQ, then production | V1 | RemNote MC Learn Mode |
| 34 | Fast timed games (Match, Lightning Round) and local/online multiplayer | V2 | Quizlet Match/Live, Duolingo, Gizmo |
| 35 | Hands-free practice / auto-advance (cards and quizzes read aloud) | V2 | Anki auto advance, SuperMemo.com |
| 36 | Activity mini-apps / plugins (extensible by the community) | Later | StudyFetch, RemNote plugins |

## 5 · Memory and scheduling (37–52)

| # | Feature | Tag | Source |
|---|---|---|---|
| 37 | FSRS-6 by default with desired retention, optimize, health check and a load simulator; SM-2 only for compatibility | MVP basic · V1 optimize/simulator | Anki, RemNote |
| 38 | Every practice item (card or exercise) has a visible and explainable D/S/R state | MVP | Anki FSRS, FSRS Helper |
| 39 | Importance levels that modulate target retention, order and auto-postpone | MVP | SuperMemo priority queue, RemNote priorities |
| 40 | Card types: basic, reverse, bidirectional, cloze (hints, nested, multi-card), multi-line list/set, image occlusion, type-in, MCQ, audio cloze, pronunciation | MVP 6 · V1 rest | Anki, RemNote |
| 41 | Card clusters / siblings with dispersion to avoid interference | V1 | RemNote, FSRS Helper |
| 42 | Separate new-card queue ("Cards to Learn"); the user decides when to introduce them | MVP | RemNote, Anki |
| 43 | Postpone / Advance / Flatten / Easy Days / holidays / Mercy | V1 | FSRS Helper, SuperMemo |
| 44 | Final drill of what was failed in the session | MVP | SuperMemo |
| 45 | Subset review, search & review, filtered decks and custom study (forgotten, review ahead, by tag/state) | V1 | SuperMemo, Anki |
| 46 | Leech detection with an AI rewrite suggestion | V1 | Anki, RemNote |
| 47 | Hints, extra detail, background insights, AI explanation of the answer | V1 | RemNote |
| 48 | Neural / semantic review: review the conceptual neighbours of the failed item | V2 | SuperMemo, Recall |
| 49 | Reset / edit the history, "Edit Later", bulk direction change, card table | V1 | RemNote, Anki browser |
| 50 | Daily goal + streak goal separated; "forgot does not count" | MVP | RemNote |
| 51 | "Currently studying" mode: spread over week / all due / fit daily target | V1 | RemNote |
| 52 | Schedule recommendation based on performance by hour and, optionally, sleep logging | V2 / Later | Anki hourly stats, SuperMemo Sleep Chart |

## 6 · Exams (53–59)

| # | Feature | Tag | Source |
|---|---|---|---|
| 53 | Scheduled exams with a date: wizard (material, date, new cards per week, order, final period, daily goal, study days, ensure mastery) | MVP | RemNote Exam Scheduler V2 |
| 54 | Learning / Catch-up / Final review periods with lateness warnings and recalculation | V1 | RemNote |
| 55 | AI mock exams with a configurable format, time, topic coverage, "only what is incomplete" | MVP | RemNote, Knowt, Memrise |
| 56 | Automatic grading (MCQ) + AI grading with a rubric for open answers and essays | V1 | RemNote, StudyFetch Essay Grader, Knowt FRQ |
| 57 | Post-exam report: by topic, by error type, grade prediction, "exam traps" | V1 | RemNote, ELSA, Knowt |
| 58 | Templates of real exams by country (ICFES, ENEM, EXANI, PAES, public-service exams) | V2 | Knowt AP/IB hubs, ELSA IELTS |
| 59 | "Blind exam" mode (no hints, timer, locked UI) and later review | V1 | RemNote Test Mode, Chess Game Review |

## 7 · Languages and speech (60–65)

| # | Feature | Tag | Source |
|---|---|---|---|
| 60 | Vocabulary cards in context with sentence, TTS audio, image and automatic translation | V1 | Migaku, Mochi, Lingvist |
| 61 | Cloze of real sentences by frequency | V1 | Clozemaster |
| 62 | Pronunciation with a per-phoneme/stress score and native feedback (Azure) | V1 | ELSA, BoldVoice, Speak |
| 63 | AI roleplay / voice conversation with scenarios, feedback tone (soft/balanced/strict) and a transcript | V2 | Duolingo Roleplay/Video Call, Praktika, SuperMemo Live |
| 64 | Assisted reading with click-to-translate and "known words" / comprehension score | V2 | Readlang, LingQ, Migaku |
| 65 | A Score-style rating aligned to CEFR | Later | Duolingo Score, ELSA |

## 8 · Notes and knowledge base (66–74)

| # | Feature | Tag | Source |
|---|---|---|---|
| 66 | Outliner/Markdown editor with blocks, references, backlinks, tags, aliases, portals | MVP basic · V1 portals/aliases | RemNote, Obsidian, Logseq |
| 67 | Create a card from any block (`>>`, `{{ }}`) without leaving the editor | MVP | RemNote, Obsidian SR |
| 68 | Daily notes / journal with a calendar | V1 | RemNote, Heptabase |
| 69 | Tables with typed columns, AI autofill and cards per cell; CSV import/export | V2 | RemNote Tables V2, Obsidian Bases |
| 70 | Search portals / saved queries (visual query builder) | V2 | RemNote, Tana |
| 71 | Canvas / whiteboard and handwriting with conversion to text/cards | V2 | RemNote Canvas, Heptabase, Excalidraw |
| 72 | Templates and a concept/descriptor framework to generate structured cards | V1 | RemNote |
| 73 | Auto-tagged knowledge graph with resurfacing of related items | V2 | Recall, Obsidian Graph |
| 74 | LaTeX, code, media, embeds | MVP basic | Anki, RemNote |

## 9 · AI tutor / chat (75–81)

| # | Feature | Tag | Source |
|---|---|---|---|
| 75 | Conversational tutor with access to the base, clickable citations, "read what is on screen" | MVP | RemNote AI Tutor, Gemini Notebook |
| 76 | Tutor actions: create cards, quiz, summary, path, table, exercise; "turn this answer into cards" | MVP | RemNote, Knowt Kai |
| 77 | Socratic mode (does not give the answer) and direct mode, switchable | V1 | ChatGPT Study Mode, Khanmigo |
| 78 | Learner memory (errors, weak topics, preferences, tone) and a tutor with personality | V1 | Praktika, Speak, Duolingo Lily |
| 79 | Model selection (fast/balanced/frontier) and BYOK (Anthropic, Google, OpenAI, local) | MVP 1 provider · V1 multi | RemNote, Recall |
| 80 | Hands-free voice tutor (oral quiz) | V2 | Knowt Kai, SuperMemo MemoChat |
| 81 | Local MCP server so external agents can query and create content | V2 | RemNote, Readwise, Heptabase CLI |

## 10 · Multimedia generation (82–87)

| # | Feature | Tag | Source |
|---|---|---|---|
| 82 | Multi-voice neural TTS for cards and theory, with a local cache | MVP system voices · V1 neural | HyperTTS, Readwise, Matter |
| 83 | Generated or searched images for cards (visual mnemonics) | V1 | Mochi, Duolingo |
| 84 | Generated audio cloze and dictations | V1 | Duolingo, Clozemaster |
| 85 | Podcast / audio overview per module and a light explainer video | V1 / V2 | Gemini Notebook, StudyFetch |
| 86 | Pronunciation assessment (STT + scoring) | V1 | ELSA, Speak |
| 87 | Diagrams for image occlusion generated or cleaned up by AI | V2 | RemNote Advanced IO |

## 11 · Gamification (88–99)

| # | Feature | Tag | Source |
|---|---|---|---|
| 88 | Streak with a separate streak goal, earned freezes (1 every 6 days, bank of 2) and holidays | MVP | RemNote, Duolingo |
| 89 | XP, levels and mastery per topic (Attempted → Familiar → Proficient → Mastered) | MVP mastery · V1 XP | Khan, Duolingo |
| 90 | Daily/weekly quests and cooperative quests with friends | V1 / V2 | Duolingo |
| 91 | Optional leagues by activity level; friends leaderboard | V2 | Duolingo, SuperMemo.com |
| 92 | Badges tied to real retention milestones | V1 | Duolingo, Khan |
| 93 | Mascot / characters with personality (configurable tone, sober mode) | V1 | Duolingo, Praktika |
| 94 | End-of-session celebrations, "Done for today", achievement summary | MVP | RemNote, Duolingo |
| 95 | Heatmap / activity calendar and load forecast | MVP | Anki, Review Heatmap |
| 96 | Smart reminders (preferred hour, streak-saver, digest), limited and editable | V1 | Duolingo |
| 97 | Pomodoro / focus mode and optional ambient sounds | V1 | Quizlet, Anki add-ons |
| 98 | Widgets: tray/badge on desktop; future mobile widget | V1 | RemNote, Duolingo |
| 99 | Energy as an opt-in soft limit (never a punishment for an error) | Later | Duolingo Energy |

## 12 · Statistics (100–105)

| # | Feature | Tag | Source |
|---|---|---|---|
| 100 | Daily panel: pending, done, time, accuracy, goal | MVP | Anki, RemNote |
| 101 | Future due, intervals, difficulty, stability, retrievability, true retention, answer buttons, hourly breakdown | V1 | Anki |
| 102 | Mastery per topic/module/source and per exam (% ready, time remaining) | MVP | RemNote |
| 103 | Forgetting curves and burden/overload; future load simulation | V2 | SuperMemo Analysis, Anki simulator |
| 104 | Exportable reports and weekly comparison | V1 | SuperMemo, RemNote |
| 105 | AI insights ("your weak topics this week", "best study hour") | V1 | ELSA, Brilliant |

## 13 · Import / export (106–110)

| # | Feature | Tag | Source |
|---|---|---|---|
| 106 | Complete export JSON + Markdown + CSV + `.apkg` (with scheduling) + PDF of guides | MVP JSON/Markdown/`.apkg` | Anki, RemNote, Readwise |
| 107 | Import of `.apkg` with media and scheduling, Quizlet, CSV/Excel, Markdown | MVP / V1 | Anki, Traverse, Knowt |
| 108 | Optional E2E sync and a portable "vault" in a folder | V1 | Obsidian |
| 109 | Local API / CLI (AnkiConnect style) | V2 | AnkiConnect, Heptabase CLI |
| 110 | Publish / share paths and decks (link, marketplace) | V2 / Later | Mochi, Brainscape, Anki |

## 14 · Settings and platform (111–120)

| # | Feature | Tag | Source |
|---|---|---|---|
| 111 | Command palette, reconfigurable shortcuts, shortcut sheet | MVP | Obsidian, RemNote, SuperMemo |
| 112 | Multi-window, split view, tabs | V1 | RemNote 1.28 |
| 113 | Light/dark/high-contrast themes, fonts (OpenDyslexic, Atkinson), size/line height, reduced motion | MVP | Obsidian, WCAG |
| 114 | Accessibility: full keyboard, visible focus, screen readers, target ≥ 24 px | MVP | WCAG 2.2, Electron |
| 115 | Localization es-LatAm, en, pt-BR; RTL prepared | MVP es/en | RemNote, Mindgrasp |
| 116 | Automatic rotating backups, version history, trash | MVP backups · V1 versions | AnkiDroid, Obsidian |
| 117 | Privacy: local-first, optional encryption at rest, BYOK, no telemetry without consent, sanitization of imports | MVP | Obsidian, Anki 25.09 |
| 118 | Resumable auto-update, terminal-free installer, code signing | MVP | Anki 26.05, RemNote |
| 119 | Profiles / spaces (several students; child mode) | V2 | Khanmigo, Family plan |
| 120 | Community plugins and themes with a sandboxed API | Later | RemNote, Obsidian |

## 15 · Commercial (later) (121–125)

| # | Feature | Tag | Source |
|---|---|---|---|
| 121 | Generous Free (all local, AI with BYOK) + Pro (AI included, sync, neural TTS) + Pro Max (frontier, voice) | V1 | RemNote tiers, Duolingo Super/Max |
| 122 | AI credits with a visible counter and "runs" per feature | V1 | RemNote |
| 123 | B2B licences: seats, SSO, teacher/company panel with retention reports and assignments | V2 | Brainscape, Duolingo Schools, Khanmigo |
| 124 | Marketplace of paths/decks with revenue sharing for creators | Later | Brainscape |
| 125 | Family plan and regional LatAm pricing (local payment) | V2 | Duolingo Family |
