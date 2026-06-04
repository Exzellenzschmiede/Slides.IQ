# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies (node_modules not committed)
npm start            # production server (node server.js)
npm run dev          # development server with hot-reload (node --watch server.js)
```

No `.env` file required. AI API keys, **SMTP/email**, and **Stripe** settings are all configured in the Admin panel (stored in the DB). The only relevant env vars are `PORT`, `SESSION_SECRET`, `DB_PATH` — all optional for local dev. Legacy `SMTP_*`, `STRIPE_*`, and `BASE_URL` env vars are still read as a one-time migration fallback, but the Admin panel always wins.

No test suite or linter is configured.

## Architecture

**Stack:** Node.js + Express backend, vanilla JS SPA frontend, SQLite (better-sqlite3), WebSocket.

### Backend

- `server.js` — Express app + WebSocket server. Mounts five routers, serves `public/` as static files, handles the public `/view/:token` endpoint and SPA fallback. Runs `migrateAllFrameworks()` on startup.
- `database.js` — Opens the SQLite DB, runs `CREATE TABLE IF NOT EXISTS` on startup, applies additive `ALTER TABLE` migrations by catching duplicate-column errors, seeds 5 default templates and global default settings if absent. Settings use a composite `(key, user_id)` primary key.
- `routes/auth.js` — Login/logout, profile update, password change. Admin sub-routes: list/create/update/delete users, toggle active, change role, reset password.
- `routes/ai.js` — All AI endpoints under `/api/ai` (rate-limited to 10 req/min). Reads the active provider + API key from admin settings via `services/aiProvider.js` — **never from env**. Returns 400 JSON before SSE headers if no key is configured.
- `routes/presentations.js` — CRUD + versioning (inline JSON array, max 20) + per-user shares + public token sharing + export (PDF via Puppeteer, HTML download).
- `routes/templates.js` — CRUD + `POST /from-pptx` (multer → parse PPTX → AI → return template suggestion without saving).
- Admin settings endpoints live directly in `server.js` (not a separate router): `GET/PUT /api/admin/ai-settings` (global AI provider), `GET/PUT /api/admin/email-settings` (SMTP), `GET/PUT /api/admin/stripe-settings` (Stripe keys + Price IDs), plus per-user plan override and framework migration. All `requireAdmin`.
- `services/appSettings.js` — Single source of truth for global **email** and **stripe** config groups (settings table, `user_id=''`). Exports `getEmailSettings()/setEmailSettings()`, `getStripeSettings()/setStripeSettings()`, `getBaseUrl()`. Unset fields fall back to the matching env var (migration only); saved values always win.
- `services/aiProvider.js` — Resolves the active provider, API key, and model from the `preferences` settings row. Exports `getGlobalPrefs()`, `getProviderSettings()`, `DEFAULT_MODELS`.
- `services/email.js` — Reads SMTP config from `appSettings` at send time (caches the nodemailer transport, rebuilds on change). Falls back to console logging in dev. Exports `getBaseUrl()` for link building.
- `services/stripe.js` — `getStripe()` factory: builds/caches a Stripe client from the Admin-managed secret key, rebuilt when the key changes; returns `null` if unset.
- `services/plans.js` — Static tier limits/features; Stripe Price IDs resolved dynamically from `appSettings` at call time via `getPlan()` / `planForPriceId()` / `publicPlans()`.
- `services/claude.js` — Multi-provider AI client. `generatePresentation()` dispatches to Anthropic/OpenAI/Mistral/Gemini based on `provider` param. `analyzeNarrativeArc()` and `suggestImprovements()` are Anthropic-only. Contains the full `PRESENTATION_FRAMEWORK` constant (CSS + JS engine injected into every HTML output). `injectFramework()` / `stripFramework()` keep the engine in sync on updates.
- `services/fileParser.js` — `parseFile()` dispatches by extension/mime to text, image (base64), CSV, Excel (ExcelJS), Word (Mammoth), PDF (pdf-parse), or PPTX (adm-zip). `parsePptxForTemplate()` additionally extracts theme colors and fonts from `ppt/theme/theme1.xml`.
- `services/pdf.js` — Puppeteer renders each slide at 1280×720 and assembles a multi-page PDF.
- `services/slideUtils.js` — Utility functions for HTML slide manipulation: count, extract, replace, insert, delete by index.

### Frontend

Single-page app in `public/`. All JS is ES modules imported via `<script type="module">`.

- `public/js/app.js` — Bootstrap: checks setup-needed, auth, initialises router + modal + toast, loads settings.
- `public/js/router.js` — Hash-based SPA router (`#/dashboard`, `#/studio/:id`, etc.). Renders views into `#view-container`.
- `public/js/api.js` — Centralised fetch wrapper (`apiFetch`). Exports `api` object with namespaced methods. Streaming generation is an `async function*` (`readSseStream`) that reads SSE chunks.
- `public/js/i18n.js` — All UI strings for 5 locales (en/de/it/nl/pl). Use `t('key')` to access.
- `public/js/views/studio.js` — Main editing UI: chat sidebar, file attachment chips, SSE streaming display, preview `<iframe>`, version history, narrative arc analysis, AI suggestions, PDF/HTML export, presenter mode (WebSocket).
- `public/js/views/admin.js` — Admin-only view with tabs: AI provider config (Anthropic/OpenAI/Mistral/Gemini), E-Mail (SMTP) settings, Stripe settings (keys + Price IDs), and a full user management table (create, edit, toggle active, change role, reset password with auto-generate).
- `public/js/views/settings.js` — Per-user brand settings, profile (name/email), password change, language — all auto-saved with 800 ms debounce.
- `public/js/views/templates.js` — Template gallery + create/edit modals + PPTX import flow.
- `public/js/components/modal.js` — Single shared modal: `showModal(title, content)`, `closeModal()`, `showConfirmModal()`. Cancel buttons use `closeModal()` via event listeners (not inline onclick).

### Key data flows

**Presentation generation:**
1. Studio sends `POST /api/ai/generate/:id` with `{prompt, attachments[]}`.
2. Server resolves provider + API key from admin settings. Returns 400 JSON if missing.
3. Builds messages array from `conversation` history (last 20) + new user message with optional vision/document blocks.
4. Opens SSE stream to the AI provider; chunks forwarded as `{type:'chunk', text}`.
5. On completion: `injectFramework()`, slide count update, version snapshot saved to inline JSON array, conversation appended, presentation persisted.

**HTML presentation format:**
Every stored presentation is a self-contained HTML file. The `PRESENTATION_FRAMEWORK` block (marked with `<!-- SLIDESIQ:FRAMEWORK:START/END -->`) contains all navigation CSS and JS and is always injected before `</body>`. The AI generates only the slides — `<div id="nexus-presentation">` containing `<div class="slide">` children. Slides are scaled via `ResizeObserver` using `transform: scale()` on a 1280×720 canvas.

**Template system:**
Templates provide a `system_prompt` (style instructions) and a `theme` JSON `{primaryColor, accentColor, bgColor, style, font}`. The system prompt is prepended in `buildSystemPrompt()`. Default templates (ids prefixed `tpl-`) cannot be deleted from the UI.

**API key management:**
Keys are stored in the `settings` table under key `preferences`, user_id `''` (global). `services/aiProvider.js` reads them. The AI routes check for a key and return a descriptive 400 error before starting any SSE stream. No env variable fallback exists.

**Email & Stripe config:**
SMTP and Stripe settings are stored in the `settings` table under keys `email` and `stripe` (user_id `''`), managed via the Admin panel and read through `services/appSettings.js`. Each field falls back to its legacy env var only when unset in the DB (one-time migration aid). Since both are resolved at call time, changing them in the Admin panel takes effect without a restart. The Base URL (email links, Stripe redirects, share links) lives in the `email` group.
