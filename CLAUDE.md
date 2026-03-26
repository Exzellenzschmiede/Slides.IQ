# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies (node_modules not committed)
npm start            # production server (node server.js)
npm run dev          # development server with hot-reload (node --watch server.js)
```

Required env var: `ANTHROPIC_API_KEY`. Copy `.env.example` to `.env`.

No test suite or linter is configured.

## Architecture

**Stack:** Node.js + Express backend, vanilla JS SPA frontend, SQLite (better-sqlite3), WebSocket.

### Backend

- `server.js` — Express app + WebSocket server. Mounts three routers, serves `public/` as static files, handles the public `/view/:token` presentation endpoint and SPA fallback.
- `database.js` — Opens the SQLite DB, runs `CREATE TABLE IF NOT EXISTS` on startup, applies additive `ALTER TABLE` migrations by catching duplicate-column errors, and seeds 5 default templates if the table is empty.
- `routes/ai.js` — All AI endpoints under `/api/ai` (rate-limited to 10 req/min). Generation streams HTML back via Server-Sent Events.
- `routes/presentations.js` — CRUD + versioning + export (PDF via Puppeteer, HTML download, share token/QR).
- `routes/templates.js` — CRUD + `POST /from-pptx` (multer → parse PPTX → Claude Haiku → return template suggestion without saving).
- `services/claude.js` — Claude API client. `generatePresentation()` streams with `claude-opus-4-5` (16k tokens). `analyzeNarrativeArc()` and `suggestImprovements()` use `claude-haiku-4-5-20251001`. `analyzeTemplateFromPptx()` also uses Haiku. Contains the full `PRESENTATION_FRAMEWORK` constant (CSS + JS engine injected into every HTML output). `injectFramework()` / `stripFramework()` keep the engine in sync on updates.
- `services/fileParser.js` — `parseFile()` dispatches by extension/mime to text, image (base64), CSV, Excel (ExcelJS), Word (Mammoth), PDF (pdf-parse), or PPTX (adm-zip). `parsePptxForTemplate()` additionally extracts theme colors and fonts from `ppt/theme/theme1.xml`.
- `services/pdf.js` — Puppeteer renders each slide at 1280×720 and assembles a multi-page PDF.

### Frontend

Single-page app in `public/`. All JS is ES modules imported via `<script type="module">`.

- `public/js/app.js` — Bootstrap: initialises router, modal, toast, loads settings.
- `public/js/router.js` — Hash-based SPA router. Renders views into `#view-container`.
- `public/js/api.js` — Centralised fetch wrapper (`apiFetch`). Exports `api` object with namespaced methods. Streaming generation is an `async function*` that reads SSE chunks.
- `public/js/views/studio.js` — Largest file (~27 KB). The main editing UI: chat sidebar, file attachment chips, SSE streaming display, preview `<iframe>`, version history, narrative arc analysis, AI suggestions, PDF/HTML export, presenter mode (WebSocket).
- `public/js/views/templates.js` — Template gallery + create/edit modals + PPTX import flow.
- `public/js/components/modal.js` — Single shared modal: `showModal(title, content, subtitle)` replaces `#modal-body` innerHTML entirely.

### Key data flows

**Presentation generation:**
1. Studio sends `POST /api/ai/generate/:id` with `{prompt, attachments[]}`.
2. Server builds a Claude messages array from `conversation` history (last 20) + new user message (text + optional vision/document blocks).
3. Claude streams HTML; chunks are forwarded as SSE `{type:'chunk', text}`.
4. On completion: framework is injected/updated, slide count computed, version saved, conversation appended.

**HTML presentation format:**
Every stored presentation is a self-contained HTML file. The `PRESENTATION_FRAMEWORK` block (marked with `<!-- SLIDESIQ:FRAMEWORK:START/END -->`) contains all navigation CSS and JS and is always injected before `</body>`. Claude generates only the slides — `<div id="nexus-presentation">` containing `<div class="slide">` children. The framework script reads these at runtime.

**Template system:**
Templates provide a `system_prompt` (style instructions for Claude) and a `theme` JSON object `{primaryColor, accentColor, bgColor, style, font}`. The system prompt is prepended to the core generation instructions in `buildSystemPrompt()`. Default templates (ids prefixed `tpl-`) cannot be deleted from the UI.
