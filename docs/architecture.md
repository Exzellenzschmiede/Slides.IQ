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
│  ├── routes/admin.js           /api/admin/*                 │
│  └── Static: public/           /                            │
│      Public view: /view/:token                              │
└────┬──────────────┬────────────────────┬────────────────────┘
     │              │                    │
┌────▼────┐  ┌──────▼──────┐  ┌─────────▼──────────┐
│ SQLite  │  │  AI APIs    │  │ Puppeteer (PDF)     │
│(better- │  │ Claude /    │  │ Headless Chromium   │
│sqlite3) │  │ OpenAI /    │  └────────────────────-┘
└─────────┘  │ Mistral /   │
             │ Gemini      │
             └─────────────┘
```

---

## Backend Components

### `server.js`

Entry point. Responsibilities:

- Creates the Express app and registers global middleware (JSON body parser, session, static files).
- Mounts all five routers.
- Registers the public `/view/:token` endpoint (no auth required).
- Registers the SPA fallback: any unmatched GET returns `public/index.html`.
- Creates the `ws` WebSocket server on the same HTTP server, used for the live audience mode.
- On startup, calls `migrateAllFrameworks()` — updates the `PRESENTATION_FRAMEWORK` block in every stored presentation to the current version.

### `database.js`

- Opens (or creates) the SQLite file at `DB_PATH`.
- Enables WAL journal mode and enforces foreign keys.
- Runs `CREATE TABLE IF NOT EXISTS` for all tables on startup.
- Applies additive schema changes by running `ALTER TABLE … ADD COLUMN` and silently catching `duplicate column` errors — no migration tracking table needed.
- Seeds five default system templates if the templates table is empty.
- Seeds default global settings (`brand`, `preferences`) with `INSERT OR IGNORE`.

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
- Admin-only user management: list, create, update, delete, toggle active, change role, reset password.

### `routes/presentations.js`

Full presentation lifecycle:

- CRUD (`GET/POST /api/presentations`, `GET/PUT/DELETE /api/presentations/:id`).
- Content update with automatic version snapshot (`PUT /api/presentations/:id/content`).
- Version restore (`POST /api/presentations/:id/restore/:versionId`).
- Individual slide delete and duplicate.
- Public share token management (create/delete).
- Per-user access grants (list, set, remove).
- PDF export (delegates to `services/pdf.js`) and HTML download.

### `routes/templates.js`

- CRUD for templates (system templates cannot be deleted by non-admin).
- Toggle template sharing (`is_public`).
- `POST /api/templates/from-pptx` — accepts a PPTX upload, delegates to `fileParser.parsePptxForTemplate()` then the AI service, returns a suggested template object without saving.

### `routes/ai.js`

All routes protected by `requireAuth` and the rate limiter (10 requests per minute per session).

- Reads the active provider + API key from admin settings via `services/aiProvider.js`.
- Returns 400 JSON (before any SSE headers) if no API key is configured.
- File upload (`POST /api/ai/upload`) — parses and stores an attachment in the session.
- Presentation generation (`POST /api/ai/generate/:presentationId`) — SSE stream.
- Individual slide edit and insert — SSE streams.
- Narrative arc analysis and improvement suggestions (Anthropic-only, non-streaming).
- Status check (`GET /api/ai/status`).

### `routes/admin.js`

Admin-only routes for global configuration:

- `GET/PUT /api/admin/ai-settings` — read and write the global AI provider config (provider name, per-provider API keys and model selections).

### `services/aiProvider.js`

Resolves the active AI provider settings from the database. Exports:

- `getGlobalPrefs()` — reads the `preferences` settings row.
- `getProviderSettings(userId?)` — returns `{ provider, apiKey, model }` for the active provider.
- `DEFAULT_MODELS` — fallback model IDs per provider.

API keys are **never** read from environment variables.

### `services/claude.js`

Multi-provider AI client:

- `generatePresentation(messages, systemPrompt, onChunk, apiKey, provider, model)` — streams HTML to `onChunk`. Dispatches to the appropriate provider SDK based on `provider`.
- `analyzeNarrativeArc(html, apiKey)` — Anthropic-only, non-streaming.
- `suggestImprovements(html, focusArea, apiKey)` — Anthropic-only, non-streaming.
- `analyzeTemplateFromPptx({…}, apiKey)` — Anthropic Haiku call to convert PPTX theme data into a template suggestion.
- `buildSystemPrompt(template, brandSettings)` — assembles the AI system prompt from the template's `system_prompt`, the `PRESENTATION_FRAMEWORK` constant (full navigation CSS + JS), and optional brand overrides.
- `injectFramework(html)` — inserts/replaces the `PRESENTATION_FRAMEWORK` block before `</body>`.
- `stripFramework(html)` — removes the framework block before sending HTML to the AI for editing.

### `services/pdf.js`

Launches Puppeteer (headless Chromium), loads each slide's HTML at 1280×720, takes a screenshot, and assembles them into a multi-page PDF using `pdf-lib`.

### `services/fileParser.js`

`parseFile(file)` dispatches by MIME type / extension:

| Format | Library |
|---|---|
| Plain text / CSV | raw buffer |
| Images | base64-encoded for vision blocks |
| Excel (.xlsx) | ExcelJS |
| Word (.docx) | Mammoth |
| PDF | pdf-parse |
| PPTX | adm-zip (text extraction) |

`parsePptxForTemplate(file)` additionally unzips `ppt/theme/theme1.xml` to extract brand colors and fonts.

### `services/slideUtils.js`

Utility functions for manipulating the slide HTML: counting slides, extracting a single slide, replacing a slide, inserting at a position, and deleting by index.

---

## Frontend SPA Structure

The SPA shell (`public/index.html`) loads `public/js/app.js` as an ES module. `app.js`:

1. Calls `GET /api/auth/setup-needed`. If true, redirects to the setup view.
2. Calls `GET /api/auth/me`. If 401, renders the login view.
3. On success: initialises the router, registers all view routes, renders the navigation sidebar.

### Router (`router.js`)

Hash-based (`#/dashboard`, `#/studio/:id`, etc.). On hash change:

1. Matches the new hash against registered routes.
2. Calls the matched view's render function with extracted params.
3. Injects the returned HTML into `#view-container`.
4. Calls `init(params)` for event binding and data loading.

### API Client (`api.js`)

`apiFetch(path, options)` — thin wrapper around `fetch` that:

- Prefixes `/api`.
- Sets `Content-Type: application/json`.
- Parses JSON or returns blob/text based on `Content-Type`.
- Throws on non-2xx responses with the server's error message.

Streaming: `api.ai.generate(id, prompt, attachments, signal)` returns an `async generator` that reads SSE response body line by line and yields parsed `{type, text}` / `{type, slideCount}` objects.

### Views

| File | Purpose |
|---|---|
| `dashboard.js` | Lists all accessible presentations; create / delete |
| `studio.js` | Main editing UI: chat, live preview iframe, version history, AI analysis |
| `slideEditor.js` | Per-slide AI edit with live preview |
| `templates.js` | Template gallery, create/edit modals, PPTX import |
| `settings.js` | User profile, brand settings, password change, language |
| `admin.js` | Global AI provider config + user management (admin only) |

---

## Data Flow: Presentation Generation

```
User types prompt in Studio chat
        │
        ▼
api.ai.generate(presentationId, prompt, attachments)
  POST /api/ai/generate/:id
        │
        ▼ (server)
1. Resolve active provider + API key from DB (admin settings)
   → Return 400 JSON immediately if no key configured
2. Load presentation + template + brand settings from DB
3. Append user message to conversation history
4. Build AI messages array:
   - Last 20 conversation turns
   - New user message with text + optional vision/document content blocks
5. Build system prompt (template instructions + framework CSS/JS + brand overrides)
6. Set SSE response headers, open streaming request to AI provider
        │
        ▼ SSE chunks streamed to browser
7. Browser appends text chunks to preview iframe srcdoc
        │
        ▼ (on stream end, server)
8. injectFramework() — insert/update navigation block
9. Count slides in generated HTML
10. Save version snapshot (inline in presentations.versions JSON)
11. Append assistant message to conversation history
12. Persist updated presentation to DB
        │
        ▼ SSE {type: 'done', slideCount: N} sent
13. Browser refreshes version history panel
```

---

## Data Flow: Presentation Sharing

**Public token share:**

1. `POST /api/presentations/:id/share` — generates a UUID token, stores in `presentations.share_token`.
2. Returns `{token, url, qrDataUrl}`.
3. Anyone with the URL hits `GET /view/:token` (no auth), server looks up the token and returns the stored HTML.

**Per-user share:**

1. `PUT /api/presentations/:id/user-shares/:userId` with `{permission}`.
2. Stored as a row in `presentation_shares`.
3. On all presentation route handlers, the server checks ownership OR a matching user-share row.

---

## WebSocket Live Audience Mode

The Studio view opens a WebSocket connection when the presenter starts "Audience Mode".

- The presenter's client sends `{type: 'slide-change', slideIndex}` messages over the socket.
- The server broadcasts the message to all other connected clients watching the same presentation (identified by `presentationId`).
- Audience clients advance their preview iframe to the broadcast slide index.

---

## Session and Auth Model

- Sessions are stored in SQLite via `better-sqlite3-session-store`.
- Passwords are hashed with bcrypt (cost factor 12).
- `req.session.userId` is set on login and cleared on logout.
- Role is stored in the `users` table (`user` | `admin`).
- Deactivated users (`is_active = 0`) cannot log in.
- The first registered user (via `/api/auth/setup`) is always created as `admin`.
- There is no JWT or token auth for the API — all API calls require a valid session cookie.

---

## Startup Behavior

On each server start:

1. `database.js` module load — schema creation + migrations + seeding.
2. `migrateAllFrameworks()` (in `server.js`) — loads every presentation from the DB, calls `injectFramework()` on its HTML, and writes it back if the framework block changed. This ensures all stored presentations run the latest navigation engine without requiring a manual migration step.
