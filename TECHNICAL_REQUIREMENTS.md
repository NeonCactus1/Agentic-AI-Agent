# Synopsis Expert Agent — Technical Requirements Document

## 1. Overview

Synopsis Expert is a web-based conversational AI agent that answers questions about research synopsis documents (PDF). Users can type or speak questions and receive grounded, cited answers in real time. The agent cites the exact page numbers it draws from and shows collapsible source excerpts below each answer.

A sample synopsis is embedded for instant use. Uploading a custom PDF replaces the sample and triggers AI-based analysis of any slide or figure pages.

---

## 2. Feature Specification

| # | Feature | Status |
|---|---------|--------|
| 1 | Chat interface — dark-mode, ChatGPT-style bubble layout | ✅ |
| 2 | Streaming responses — tokens appear character-by-character | ✅ |
| 3 | Multi-turn conversation — full message history passed each request | ✅ |
| 4 | Voice input — browser-native speech recognition, auto-submits on end | ✅ |
| 5 | Funny rotating thinking messages while the agent processes | ✅ |
| 6 | Page-level citations rendered as inline badges (e.g. `p. 2`) | ✅ |
| 7 | Collapsible source cards showing the exact excerpt cited | ✅ |
| 8 | Sample synopsis pre-loaded — no setup required to demo | ✅ |
| 9 | PDF upload — drag-and-drop or file picker | ✅ |
| 10 | AI vision description of slide/figure pages on upload | ✅ |
| 11 | API key kept server-side — not exposed in browser or frontend code | ✅ |
| 12 | Deployed to Vercel — frontend on CDN, backend as serverless function | ✅ |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│                                                             │
│   React 19 + Vite (static, served from Vercel CDN)         │
│   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│   │  Chat UI     │   │ Upload UI    │   │ Voice input   │  │
│   │  (chat.jsx)  │   │ (drag+drop)  │   │ (Web Speech)  │  │
│   └──────┬───────┘   └──────┬───────┘   └───────┬───────┘  │
│          │                  │                   │           │
└──────────┼──────────────────┼───────────────────┼───────────┘
           │ POST /api/chat   │ POST /api/upload  │ fills input
           │ (SSE stream)     │                   │
┌──────────▼──────────────────▼───────────────────┼───────────┐
│                Vercel Serverless Function                    │
│                   (api/index.py — FastAPI)                  │
│                                                             │
│   /api/chat ──────────────────► OpenRouter API             │
│                                  Claude Sonnet 4.5          │
│                                  (streaming)                │
│                                                             │
│   /api/upload                                               │
│     ├── pdfplumber  ── extract text pages                   │
│     ├── pymupdf     ── render slide pages as PNG            │
│     └── OpenRouter  ── Claude vision → describe slides      │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Frontend

| Item | Detail |
|------|--------|
| Framework | React 19 |
| Build tool | Vite 8 |
| Language | JavaScript (JSX) |
| Styling | Inline JS style objects + injected CSS keyframes |
| State | React `useState` / `useMemo` / `useCallback` / `useRef` |
| Routing | None (single page) |
| LLM calls | Fetch to `/api/chat` (SSE stream, parsed with `ReadableStream`) |
| Voice | Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) |

### 3.2 Backend

| Item | Detail |
|------|--------|
| Framework | FastAPI (Python) |
| Runtime | Vercel Python serverless (`api/index.py`) |
| PDF text extraction | pdfplumber |
| PDF image rendering | pymupdf (fitz) — 2× zoom for legibility |
| LLM / Vision | OpenRouter API (OpenAI-compatible), Claude Sonnet 4.5 |
| Streaming | FastAPI `StreamingResponse` with SSE |
| Secret management | `OPENROUTER_API_KEY` environment variable — never in code |

### 3.3 Deployment

| Item | Detail |
|------|--------|
| Platform | Vercel |
| Frontend delivery | Vercel CDN (static build from `chat-ui/dist`) |
| Backend delivery | Vercel Python serverless function (`api/index.py`) |
| API routing | `/api/*` rewrites to serverless function; all else served statically |
| Source control | GitHub (`NeonCactus1/Agentic-AI-Agent`) — auto-deploys on push to `main` |

---

## 4. Data Flow

### 4.1 Chat (question → answer)

```
User types/speaks question
  → chat.jsx appends to messages[]
  → POST /api/chat  { messages: [...], system: "<chunks>" }
  → FastAPI streams from OpenRouter (Claude Sonnet 4.5)
  → SSE events parsed in browser, tokens appended live
  → Citations detected (regex) → source cards rendered
```

### 4.2 PDF Upload

```
User drops PDF
  → POST /api/upload  (multipart form)
  → Backend: pdfplumber classifies each page (text vs slide)
       text pages  → extract text, detect section headings,
                     chunk into 500-800 token segments
       slide pages → render to PNG with pymupdf
                     → describe with Claude vision API
  → Returns chunks[] JSON
  → Frontend replaces sample chunks, clears conversation
```

### 4.3 Document chunking

Pages are classified as `text` or `slide` based on character count (< 50 chars = slide). Text pages are split on numbered headings (`1. Title`, `1.1 Title`) into sections, then chunked at 500–800 tokens. Each chunk carries: `id`, `page`, `section`, `content_type`, `text`, `tokens`.

---

## 5. Project Structure

```
Agentic-AI-Agent/
├── api/
│   └── index.py          # FastAPI serverless function (upload + chat)
├── chat-ui/
│   ├── src/
│   │   ├── main.jsx      # React entry point
│   │   ├── App.jsx       # Root component (renders ChatApp)
│   │   ├── chat.jsx      # Entire UI: chat, upload, voice, streaming
│   │   └── index.css     # Global resets
│   ├── package.json
│   └── vite.config.js    # Vite config + /api proxy for local dev
├── ingest.py             # Standalone CLI: PDF → chunks.json
├── agent.py              # Standalone CLI: ask a question via terminal
├── server.py             # Local FastAPI server (same logic as api/index.py)
├── requirements.txt      # Python dependencies
├── vercel.json           # Vercel build + routing config
└── TECHNICAL_REQUIREMENTS.md
```

---

## 6. Dependencies

### Python (`requirements.txt`)

| Package | Purpose |
|---------|---------|
| `pdfplumber` | Text extraction and page analysis from PDF |
| `pymupdf` | Render PDF pages as images for vision model |
| `openai` | OpenAI-compatible client for OpenRouter API |
| `fastapi` | Web framework for the serverless backend |
| `uvicorn` | ASGI server for local development |
| `python-multipart` | Multipart form parsing (file upload) |
| `anthropic` | (Optional) Direct Anthropic SDK |

### Node (`chat-ui/package.json`)

| Package | Purpose |
|---------|---------|
| `react` `react-dom` | UI framework |
| `vite` | Build tool and dev server |
| `@vitejs/plugin-react` | JSX transform |

---

## 7. Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `OPENROUTER_API_KEY` | Vercel project settings / local shell | Authenticates all LLM calls (chat + vision) |

---

## 8. Local Development Setup

### Prerequisites

- Python 3.9+
- Node.js 18+ (with npm)
- An [OpenRouter](https://openrouter.ai) API key
- `poppler` (optional — only needed for the standalone `ingest.py` CLI script)
  - macOS: `brew install poppler`

### Step 1 — Clone the repo

```bash
git clone https://github.com/NeonCactus1/Agentic-AI-Agent.git
cd Agentic-AI-Agent
```

### Step 2 — Install Python dependencies

```bash
pip3 install -r requirements.txt
```

### Step 3 — Install frontend dependencies

```bash
cd chat-ui
npm install
cd ..
```

### Step 4 — Set the API key

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

### Step 5 — Start the backend

```bash
python3 -m uvicorn server:app --reload --port 8000
```

The backend runs at `http://localhost:8000`. Endpoints:
- `POST /api/upload` — upload a PDF, returns chunks JSON
- `POST /api/chat` — streaming chat (SSE)

### Step 6 — Start the frontend

In a second terminal:

```bash
cd chat-ui
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to the backend automatically.

---

## 9. Production Deployment (Vercel)

1. Push to `main` on GitHub — Vercel auto-deploys via GitHub integration
2. Set `OPENROUTER_API_KEY` in Vercel project → **Settings → Environment Variables**
3. Vercel runs `cd chat-ui && npm install && npm run build`, serves output from `chat-ui/dist`
4. `api/index.py` is deployed as a Python serverless function

---

## 10. Known Limitations

| Limitation | Impact |
|------------|--------|
| Vercel Hobby plan: 10s function timeout | PDF upload with many slide pages may time out. Upgrade to Pro (60s) for larger documents |
| Slide vision is sequential | Each slide page makes one blocking API call during upload — slow for image-heavy PDFs |
| Chunks hardcoded as sample in UI | If backend is unavailable, the sample synopsis still works but custom upload fails |
| Voice input: Chrome/Edge only | Web Speech API has limited support in Firefox and Safari |
| No persistent storage | Uploaded document chunks live in browser memory only — lost on refresh |
