# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (SPA)                           │
│  public/js/                                                 │
│  ├── app.js        bootstrap, auth check, router init       │
│  ├── router.js     hash-based routing, view mounting        │
│  ├── api.js        fetch wrapper, SSE stream consumer       │
│  ├── i18n.js       locale strings (en/de/it/nl/pl)          │
│  ├── views/        dashboard, studio, slideEditor,          │
│  │                 templates, settings, admin               │
│  └── components/   modal, toast                             │
└────────────────────────┬────────────────────────────────────┘
                         │  HTTP REST / SSE / WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                  Express Server (server.js)                  │
│                                                             │
│  Middleware                                                  │
│  ├── express-session (SQLite store)                         │
│  ├── middleware/auth.js  requireAuth / requireAdmin         │
│  └── express-rate-limit  (AI routes: 10 req/min)            │
│                                                             │
│  Routers                                                    │
│  ├── routes/auth.js            /api/auth/*                  │
│  ├── routes/presentations.js   /api/presentations/*         │
│  ├── routes/templates.js       /api/templates/*             │
│  ├── routes/ai.js              /api/ai/*                    │
│  └── Static: public/           /                            │
│      Public view: /view/:token                              │
└────┬──────────────┬────────────────────┬────────────────────┘
     │              │                    │
┌────▼────┐  ┌──────▼──────┐  ┌─────────▼──────────┐
│ SQLite  │  │ Claude API  │  │ Puppeteer (PDF)     │
│(better- │  │(Anthropic)  │  │ Headless Chromium   │
│sqlite3) │  │             │  └────────────────────-┘
└─────────┘  └─────────────┘
```

---

## Backend Components

### `server.js`

Entry point. Responsibilities:

- Creates the Express app and registers global middleware (JSON body parser, session, static files).
- Mounts all four routers.
- Registers the public `/view/:token` endpoint (no auth required).
- Registers the SPA fallback: any unmatched GET returns `public/index.html`.
- Creates the `ws` WebSocket server on the same HTTP server, used for the live audience mode.
- On startup, calls `database.initialize()` and `migrateAllFrameworks()` (updates the `PRESENTATION_FRAMEWORK` block in every stored presentation to the current version).

### `database.js`

- Opens (or creates) the SQLite file at `DB_PATH`.
- Enables WAL journal mode and enforces foreign keys.
- Runs `CREATE TABLE IF NOT EXISTS` for all six tables on startup.
- Applies additive schema changes by running `ALTER TABLE … ADD COLUMN` and silently catching `duplicate column` errors — no migration tracking table needed.
- Seeds five default system templates if the templates table is empty.

### `middleware/auth.js`

Two Express middlewares:

- `requireAuth` — returns 401 if `req.session.userId` is not set.
- `requireAdmin` — returns 403 if the session user's role is not `admin`.

### `routes/auth.js`

Handles all identity concerns:

- First-run setup (`GET /api/auth/setup-needed`, `POST /api/auth/setup`).
- Login / logout (session-based, bcrypt password comparison).
- Current-user profile read and update (`GET/PUT /api/auth/me`).
- Password change (`PUT /api/auth/me/password`).
- Admin-only user management: list, create, delete, update, change role, reset password.

### `routes/presentations.js`

Full presentation lifecycle:

- CRUD (`GET/POST /api/presentations`, `GET/PUT/DELETE /api/presentations/:id`).
- Content update with automatic version snapshot (`PUT /api/presentations/:id/content`).
- Version restore (`POST /api/presentations/:id/restore/:versionId`).
- Individual slide delete and duplicate.
- Share token management (create/delete public link, per-user access grants).
- PDF export (delegates to `services/pdf.js`) and HTML download.

### `routes/templates.js`

- CRUD for templates (system templates cannot be deleted by non-admin).
- Toggle template sharing.
- `POST /api/templates/from-pptx` — accepts a PPTX upload, delegates to `fileParser.parsePptxForTemplate()` then `claude.analyzeTemplateFromPptx()`, returns a suggested template object without saving.

### `routes/ai.js`

All routes protected by `requireAuth` and the rate limiter (10 requests per minute per session).

- File upload (`POST /api/ai/upload`) — parses and stores an attachment in memory for the session.
- Presentation generation (`POST /api/ai/generate/:presentationId`) — SSE stream.
- Individual slide edit and insert — SSE streams.
- Narrative arc analysis and improvement suggestions.
- Status check (`GET /api/ai/status`).

### `services/claude.js`

Wraps the Anthropic SDK:

- `generatePresentation(messages, systemPrompt, onChunk)` — streams with `claude-opus-4-5` at 16 k output tokens. Calls `onChunk` for each text delta.
- `analyzeNarrativeArc()` and `suggestImprovements()` — non-streaming calls with `claude-haiku-4-5-20251001`.
- `analyzeTemplateFromPptx()` — Haiku call that turns PPTX theme data into a template suggestion.
- `buildSystemPrompt(template, brandSettings)` — assembles the generation system prompt from the template's `system_prompt` field, the `PRESENTATION_FRAMEWORK` constant (full navigation CSS + JS), and optional brand overrides.
- `injectFramework(html)` — inserts the current `PRESENTATION_FRAMEWORK` block before `</body>` if not present; replaces it if already present.
- `stripFramework(html)` — removes the framework block (used before sending HTML to Claude for editing, so Claude never sees or modifies framework code).

### `services/pdf.js`

Launches Puppeteer (headless Chromium), loads each slide's HTML at 1280×720, takes a screenshot, and assembles them into a multi-page PDF using `pdf-lib`.

### `services/fileParser.js`

`parseFile(file)` dispatches by MIME type / extension:

| Format | Library |
|---|---|
| Plain text | raw buffer |
| Images | base64-encoded for vision blocks |
| CSV | raw text |
| Excel (.xlsx) | ExcelJS |
| Word (.docx) | Mammoth |
| PDF | pdf-parse |
| PPTX | adm-zip (text extraction) |

`parsePptxForTemplate(file)` additionally unzips `ppt/theme/theme1.xml` to extract brand colors and fonts.

### `services/slideUtils.js`

Utility functions for manipulating the slide HTML: counting slides, extracting a single slide, replacing a slide, inserting a slide at a position, and deleting a slide by index.

---

## Frontend SPA Structure

The SPA shell (`public/index.html`) loads `public/js/app.js` as an ES module. `app.js`:

1. Calls `GET /api/auth/setup-needed`. If true, redirects to the setup view.
2. Calls `GET /api/auth/me`. If 401, renders the login view.
3. On success: initialises the router, registers all view routes, and renders the navigation.

### Router (`router.js`)

Hash-based (`#/dashboard`, `#/studio/:id`, etc.). On hash change:

1. Matches the new hash against registered routes.
2. Calls the matched view's `render(params)` function.
3. Injects the returned HTML into `#view-container`.
4. Calls the view's `init(params)` function for event binding and data loading.

### API Client (`api.js`)

`apiFetch(path, options)` — thin wrapper around `fetch` that:

- Prefixes `/api`.
- Sets `credentials: 'include'`.
- Parses JSON responses.
- Redirects to login on 401.

Streaming: `api.ai.generate(id, body)` returns an `async generator` that reads the SSE response body line by line and yields parsed `{type, text}` objects.

### Views

| File | Purpose |
|---|---|
| `dashboard.js` | Lists all accessible presentations; create / delete |
| `studio.js` | Main editing UI: chat, live preview iframe, version history, analysis |
| `slideEditor.js` | Per-slide WYSIWYG edit with AI assist |
| `templates.js` | Template gallery, create/edit, PPTX import |
| `settings.js` | User profile, brand settings, language |
| `admin.js` | User management (admin only) |

---

## Data Flow: Presentation Generation

```
User types prompt in Studio chat
        │
        ▼
api.ai.generate(presentationId, {prompt, attachments})
  POST /api/ai/generate/:id
        │
        ▼ (server)
1. Load presentation + template + brand settings from DB
2. Append user message to conversation history
3. Build Claude messages array:
   - Last 20 conversation turns
   - New user message with text + optional vision/document content blocks
4. Build system prompt (template instructions + framework CSS/JS)
5. Open streaming request to Claude API (claude-opus-4-5, 16k tokens)
        │
        ▼ SSE chunks streamed to browser
6. Browser appends text chunks to preview iframe srcdoc
        │
        ▼ (on stream end, server)
7. injectFramework() — insert/update navigation block
8. Count slides in generated HTML
9. Save version snapshot
10. Append assistant message to conversation history
11. Persist updated presentation to DB
        │
        ▼ SSE {type: 'done'} sent
12. Browser refreshes version history panel
```

---

## Data Flow: Presentation Sharing

**Public token share:**

1. `POST /api/presentations/:id/share` — generates a UUID token, stores in `presentation_shares` with `share_type='public'`.
2. Returns `{token, url, qrDataUrl}`.
3. Anyone with the URL hits `GET /view/:token` (no auth), server looks up the token, returns the stored HTML.

**Per-user share:**

1. `POST /api/presentations/:id/user-shares/:userId` with `{permission: 'read'|'write'|'delete'}`.
2. Stored as a row in `presentation_shares` with `share_type='user'`.
3. On all presentation route handlers, the server checks ownership OR a matching user-share row.

---

## WebSocket Live Audience Mode

Studio view opens a WebSocket connection when the presenter starts "Audience Mode".

- The presenter's client sends `{type: 'slide-change', slideIndex}` messages over the socket.
- The server broadcasts the message to all other connected clients watching the same presentation (identified by `presentationId`).
- Audience clients advance their preview iframe to the broadcast slide index.

---

## Session and Auth Model

- Sessions are stored in SQLite via `better-sqlite3-session-store`.
- Passwords are hashed with bcrypt (cost factor 10).
- `req.session.userId` is set on login and cleared on logout.
- Role is stored in the `users` table (`user` | `admin`).
- The first registered user (via `/api/auth/setup`) is always created as `admin`.
- There is no JWT or token auth for the API — all API calls require a valid session cookie.

---

## Startup Behavior

On each server start:

1. `database.initialize()` — schema creation + migrations + seeding.
2. `migrateAllFrameworks()` (in `server.js`) — loads every presentation from the DB, calls `injectFramework()` on its HTML, and writes it back if the framework block changed. This ensures all stored presentations run the latest navigation engine without requiring a manual migration step.
