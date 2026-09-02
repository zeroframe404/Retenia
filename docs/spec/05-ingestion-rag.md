Source: Retenia research PDF v1.0 (Sep 2026), section 8

# Source ingestion and local RAG

How each source type enters (PDF, DOCX, EPUB, PPTX, images, audio, video, YouTube, web),
what is processed for free on your PC and what is sent to an API, and the design of the
local index (SQLite + FTS5 + sqlite-vec) that feeds the chat, the grading and the
generation.

## Table of contents

- [1. Strategy per source type](#1-strategy-per-source-type)
- [2. Cloud OCR and parsing: price per 1,000 pages](#2-cloud-ocr-and-parsing-price-per-1000-pages)
- [3. Embeddings, rerankers and vector store](#3-embeddings-rerankers-and-vector-store)
- [4. Local RAG design](#4-local-rag-design)
- [5. Chunking benchmarks](#5-chunking-benchmarks)
- [6. Monthly ingestion cost (intensive user)](#6-monthly-ingestion-cost-intensive-user)

---

## 1. Strategy per source type

| Source | Tool (free, local, Node) | When to escalate to OCR / VLM / API |
|---|---|---|
| **Native PDF (born-digital)** | `pdfjs-dist` 6 in Node (text + per-page positions → navigable citations); `unpdf` as a wrapper; `@hyzyla/pdfium` (MIT) to render pages to PNG (thumbnails, OCR). PyMuPDF is better but AGPL. | If a page returns < 50 characters or disordered text → it is scanned → OCR. Only pages with figures go to the vision model. |
| **Scanned PDF / photos of handwritten notes** | Tesseract.js 7 (Apache 2.0, WASM, 100+ languages) for print; weak on handwriting and layout. | Always VLM/OCR: Gemini 2.5 Flash-Lite as OCR (≈ USD 0.25 per 1,000 pages), LlamaParse (10,000 free credits/month), Mistral OCR 4.1 (USD 4 / 2 batch per 1,000 pages, with bounding boxes). Advanced local: PaddleOCR-VL 1.6 or Docling in a Python sidecar (v2). |
| **DOCX** | `mammoth` (BSD-2) → HTML/Markdown with headings, lists, tables, images. | OMML equations: mammoth ignores them → extract from the XML or use Pandoc. |
| **EPUB** | spine + XHTML per chapter (`fflate` + parser); reader with foliate-js (vendored) or epub.js. | Never. |
| **PPTX** | Unzip and parse `ppt/slides/slideN.xml` (≈ 150 own lines) or `officeparser`; images via unzip. | Slides with diagrams as an image → optional VLM. |
| **Images with text** | Tesseract.js (print); description with a cheap multimodal model (Qwen3.7-flash, Gemini Flash-Lite: 258 tokens per image). | Handwritten or mixed → Gemini / Mistral. |
| **Formulas and tables** | pix2tex/LaTeX-OCR (MIT) in a small sidecar; pdf.js positions + heuristics (fragile). | Math-heavy → Mistral OCR, Marker balanced (83.9 % in math), Gemini; complex tables → Docling/Marker/Mistral. |
| **Audio (classes, podcasts)** | Local Whisper: Parakeet-TDT-0.6b-v3 (25 European languages, mean WER 6.34 %, CC-BY-4.0) or whisper-large-v3-turbo via `sherpa-onnx` (Node addon, CUDA) or a bundled `whisper.cpp` CLI; timestamps per segment. | Cloud fallback: AssemblyAI Universal (USD 0.15/h + 0.02 diarization; 185 h free), ElevenLabs Scribe v2 (0.22/h, 10 h files), Groq whisper-turbo (0.04/h, chunks < 25 MB). |
| **Video / Udemy-style courses** | ffmpeg (LGPL build) extracts 16 kHz mono audio for Whisper and keyframes on scene change (`select='gt(scene,0.3)'`) or sampling every 10 s + dHash (Hamming < 8 = duplicate) → **20–60 keyframes/hour**; OCR/description of each keyframe (258 tokens in Gemini/Qwen); merge of "what it says + what it shows" into 2–5 min chunks; the course index (folders/modules) is already a candidate outline. | **Never send the whole video:** 20 h = 72,000 s × 263 tokens/s ≈ **18.9M tokens** (does not fit in 1M; ≈ USD 14 in Gemini 3.7 Flash). Optional cloud transcription: Gemini audio 32 tokens/s → 20 h ≈ 2.3M tokens ≈ USD 1.7. |
| **YouTube** | 1) `youtube-transcript` (npm, free; internal endpoints; works better with a residential IP); 2) if it fails, Gemini with the public URL (8 h of video/day free; ~100 tokens/s at low resolution + 32 for audio: 10 min ≈ USD 0.024 with Flash, 0.008 with Flash-Lite) asking for a transcript with timestamps + chapters. | Data API `captions.download` only for your own videos. **yt-dlp violates YouTube's ToS: out of the base product** (at most an optional plugin under the user's responsibility). |
| **Web** | Defuddle (MIT, from Obsidian; preserves footnotes, equations and code blocks) or Readability + JSDOM → Markdown with Turndown; a hidden `BrowserWindow` for SPAs (if the static HTML brings < 500 words). | Jina Reader (free 20 RPM; 10M tokens with a key) or Firecrawl (1,000 credits/month) for complete documentation sites. |
| **Udemy / Coursera / Vimeo** | No download API and terms that forbid it: the user supplies their own local files (their own recordings, the course's PDFs) and the app transcribes locally. | Document that copyrighted material is processed locally and is not redistributed. |

**Rule:** born-digital → free local extraction; scanned, handwritten, formulas or complex
layout → OCR with a VLM. Detect automatically by extractable text density and the presence
of full-page images.

With pure Node (pdf.js, mammoth, epub, pptx, Tesseract.js, Transformers.js, sqlite-vec,
Mermaid, Defuddle) **80 % of sources** are resolved with nothing to install; the Python
sidecar (Docling/PaddleOCR-VL, ComfyUI, pix2tex, faster-whisper) is a downloadable
"advanced package", **not part of the installer** (PyInstaller is number one in antivirus
false positives).

## 2. Cloud OCR and parsing: price per 1,000 pages

| Service | USD / 1,000 pages | Output | Math / handwriting | Free |
|---|---|---|---|---|
| Gemini 2.5 Flash-Lite as OCR | ≈ 0.23 | Markdown/JSON/LaTeX on request | Very good on handwriting; math good | Free tier |
| Gemini 3.1 Flash-Lite / 3 Flash | ≈ 0.8 / ≈ 1.6 | idem | Better (Flash 3.5: 76.4 olmOCR-bench) | Free tier |
| Mistral OCR 4.1 | 4 (batch 2) | Markdown + images + bounding boxes + confidence | 170 languages; olmOCR-bench 85.2 | No |
| LlamaParse | 1.25 Fast · 3.75 Cost-effective · 12.50 Agentic | Markdown/JSON with layout | Agentic uses VLMs | 10,000 credits/month |
| Datalab (Marker API) | 4 (accurate 10) | Markdown/HTML/JSON | Chandra 2: 85.8 | USD 10–20 of credit |
| Claude Haiku 4.5 as OCR | ≈ 4.4 (batch −50 %) | Markdown | Very good on handwriting | No |
| Azure Document Intelligence / Google Document AI / Reducto | 1.5–10 / 1.5–30 / 10–20 | JSON | Handwriting yes | 500–1,000 pages/month |
| **Local:** Docling (MIT) · PaddleOCR-VL 1.6 (Apache) · Marker v2 · MinerU · Chandra 2 | 0 | Markdown/JSON | Docling 50.3 (weak on scans); PaddleOCR-VL 96.3 % OmniDocBench; Marker 76 (weights with a commercial licence above USD 2M–5M of revenue) | Python sidecar |

**Two scanned 300-page books per month:** Gemini Flash-Lite ≈ USD 0.15 · LlamaParse USD 0
(within quota) · Mistral batch USD 1.20.

## 3. Embeddings, rerankers and vector store

### Embedding models

| Model | USD / 1M tokens | Dims | Context | Multimodal | Free |
|---|---|---|---|---|---|
| OpenAI text-embedding-3-small / large (Matryoshka) | 0.02 / 0.13 (batch 0.01) | 1536 / 3072 | 8,191 | No | No |
| Google gemini-embedding-2 (preview) | 0.15 (Vertex) · not read in the Gemini API | 128–3072 | 8,192 | Yes (text, ≤ 6 images, audio ≤ 180 s, video ≤ 120 s, PDF ≤ 6 pages) | Free tier |
| Voyage voyage-4 / 4-lite / 4-large (recommended by Anthropic) | 0.06 / 0.02 / 0.12 (batch −33 %) | flexible | 32K | voyage-multimodal-3.5 separately | 200M tokens per family |
| Cohere Embed 4 | 0.12 (image 0.47) | 256–1536 | 128K | Yes | Non-commercial trial |
| Jina v4 / v5-omni | not published per token | 2048 | 32K | Yes (v5-omni: audio and video) | 10M tokens |
| **Local:** EmbeddingGemma-300M (768 dims, Matryoshka, 100+ languages, ≈ 300–600 MB) · bge-m3 (567M, 1024 dims, 8K, dense + sparse) · multilingual-e5-small (384 dims, 120 MB) · qwen3-embedding 0.6B/4B | 0 | — | — | — | Via `@huggingface/transformers` 4.x (ONNX; WebGPU/WASM in the renderer, CPU/CUDA in Node; official Electron tutorial) or Ollama `/v1/embeddings`. A 300-page book: 1–3 min on GPU, 10–20 on CPU. |

Embedding a 300-page book (~160–200k tokens) costs **USD 0.004** with text-embedding-3-small
and **USD 0** with Voyage (within the 200M free) or locally: embeddings are irrelevant in the
budget.

### Where the real RAG cost is

- **Contextualization:** Haiku 4.5 batch ≈ USD 0.30 per book; Gemini Flash-Lite ≈ 0.10.
- **Reranking:** Cohere Rerank 4: USD 2–2.5 per 1,000 searches; Voyage rerank-3-lite: 0.02
  per 1M tokens with 200M free; local: mxbai-rerank-base-v2 or bge-reranker-v2-m3, free,
  0.2–1 s per 20 documents on CPU.

Store the `model_id` per embedding and **never mix spaces**; reindex as a job.

### Vector store

| Vector store | Type | Index | FTS / hybrid | State and licence | Verdict |
|---|---|---|---|---|---|
| `sqlite-vec` (`vec0`) 0.1.9 | SQLite extension (same file as the app) | Brute force (no ANN); int8/binary; partition keys and metadata | With FTS5 in the same DB (RRF in SQL) | Pre-v1 (breaking changes possible), Apache/MIT, funded by Mozilla; binaries per platform | **v1** if the corpus < ~200k chunks: a single file, transactions, trivial backups |
| LanceDB 0.38 (`@lancedb/lancedb`) | Embedded, Lance files | IVF-PQ, HNSW | BM25 (Tantivy) + hybrid + integrated rerankers; blobs | Stable, Apache 2.0, Windows x64 | When > 200k chunks or multimodal search |
| Vectra · Orama · hnswlib-node · Chroma · pgvector · sqlite-vss | Prototypes · instant search in the UI · if sqlite-vec turns out slow · requires a Python server · for the future SaaS · abandoned (discard) | | | | |

## 4. Local RAG design

1. **Parser** (table above) → Markdown + metadata → **semantic chunker per section of
   300–500 tokens** with 10–15 % overlap, heading path as metadata
   (`Book > Ch. 3 > 3.2`), whole tables and code blocks, inline KaTeX formulas;
   transcripts in 60–90 s windows aligned to pauses with `start/end` ("jump to the
   minute"); web pages by H2/H3.
2. **Optional contextualization** (toggle "improved index" with the cost shown): 50–100
   tokens of context per chunk with Haiku 4.5 Batch or Gemini Flash-Lite.
3. **Embeddings:** EmbeddingGemma/bge-m3 local by default; text-embedding-3-small or
   voyage-4-lite in the cloud (nearly free).
4. **Storage:** SQLite (better-sqlite3) with `chunks`, `chunks_fts` (FTS5, tokenizer
   `unicode61 remove_diacritics 2` + trigram for Spanish) and `chunks_vec` (sqlite-vec,
   int8, partition by `source_id`); **one single file per library**.
5. **Hybrid search:** top-50 BM25 ∪ top-50 vector → **Reciprocal Rank Fusion** → local
   reranker → top-10–20 to the LLM, with `chunk_id → block_ids` for exact citations.
6. **Late chunking / ColBERT:** not in v1 (indexes 10–50× larger); `voyage-context-4` as a
   cloud alternative if needed.

## 5. Chunking benchmarks

Benchmarks (NVIDIA 2024, Chroma): page-level and recursive ~400–512 tokens perform well
(**recall 88–89 %**); semantic chunking wins 2–3 points at much higher cost; the gap between
the best and the worst strategy reaches **9 %**.

For us the chunk serves both to cite and to feed lesson prompts, not only to retrieve:
**prioritize semantic boundaries (headings) over size.**

## 6. Monthly ingestion cost (intensive user)

| Item | Cheap route | Premium route |
|---|---|---|
| OCR of 600 scanned pages | Gemini Flash-Lite USD 0.15 (or LlamaParse free) | Mistral OCR batch 1.20 / standard 2.40 |
| Embeddings (840k tokens: 2 books + 20 h of transcripts + 50 webs + 10 videos) | Local USD 0 (cloud 3-small 0.017) | voyage-4 0.05 |
| Contextual retrieval (640k tokens) | Off: 0 | Flash-Lite ≈ 0.15 / Haiku 4.5 batch ≈ 0.65 |
| Reranking | Local 0 | Cohere ≈ 1 (500 searches) |
| Web (50 pages) and YouTube (10 videos) | USD 0 + ≈ 0.10 (5 without captions via Gemini URL) | Firecrawl / Supadata free tiers |
| Transcription of 20 h of your own audio | Local Whisper 0 | gpt-4o-mini-transcribe 3.60 / AssemblyAI 3.00 |
| **Total ingestion** | **≈ USD 0.25** | **≈ USD 6–8** |
