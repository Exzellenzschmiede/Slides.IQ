# Slides.IQ

AI-powered presentation builder — generate, edit, and share HTML slide decks via Claude.

**Stack:** Node.js · Express · SQLite · Vanilla JS SPA · WebSocket · Anthropic Claude API

---

## Description

Slides.IQ turns a text prompt into a fully styled, self-contained HTML presentation in seconds. It streams slide content from Claude directly into a live preview, supports multi-user access with roles and per-presentation permissions, and lets audiences follow along in real time. Presentations are stored as portable HTML files and can be exported to PDF or shared via a public link.

---

## Features

- AI generation with live SSE streaming (Claude Opus / Sonnet / Haiku)
- Multi-user auth with roles (user / admin) and per-presentation share permissions
- 5 built-in design templates + custom templates per user
- PPTX template analysis (extract colors/fonts and convert to a template)
- File upload context: PDF, Word, Excel, PPTX, images
- WYSIWYG slide editor (edit individual slides with AI assist)
- Version history (last 20 versions, one-click restore)
- PDF export (Puppeteer) and HTML download
- Public sharing via token link + QR code, plus per-user permission grants
- Live audience mode via WebSocket
- Keyboard shortcuts, fullscreen, overview grid, speaker notes
- Multilingual UI (English, German, Italian, Dutch, Polish)
- Brand settings per user
- Auto-save

---

## Prerequisites

- Node.js 18 or later
- An [Anthropic API key](https://console.anthropic.com/)

---

## Quick Start

```bash
git clone <repo-url> slides-iq
cd slides-iq
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY
npm install
npm run dev
```

Open `http://localhost:3000`. On first launch you will be prompted to create an admin account.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `PORT` | No | `3000` | HTTP server port |
| `SESSION_SECRET` | No | random | Express session secret (set in production) |
| `BASE_URL` | No | auto-detect | Base URL used in public share links (e.g. `https://slides.example.com`) |
| `DB_PATH` | No | `./data/nexus.db` | Path to the SQLite database file |

---

## Scripts

| Command | Description |
|---|---|
| `npm install` | Install dependencies |
| `npm start` | Start production server (`node server.js`) |
| `npm run dev` | Start dev server with hot-reload (`node --watch server.js`) |

---

## Architecture Overview

```
Browser (Vanilla JS SPA)
        |  REST + SSE + WebSocket
        v
Express Server (server.js)
  ├── routes/auth.js          — Authentication, user management
  ├── routes/presentations.js — CRUD, sharing, export, versioning
  ├── routes/templates.js     — Template management, PPTX analysis
  └── routes/ai.js            — AI generation (rate-limited, SSE)
        |
        ├── services/claude.js      — Anthropic API client
        ├── services/pdf.js         — Puppeteer PDF rendering
        ├── services/fileParser.js  — Multi-format file parsing
        └── database.js             — SQLite (better-sqlite3)
```

See [`docs/architecture.md`](docs/architecture.md) for a detailed breakdown.
Additional references:

- [`docs/api.md`](docs/api.md) — Full API endpoint reference
- [`docs/database.md`](docs/database.md) — Schema, migrations, indexes
- [`docs/presentation-format.md`](docs/presentation-format.md) — HTML slide format spec
- [`docs/development.md`](docs/development.md) — Developer guide

---

## License

MIT
