# Development Guide

---

## Project Setup

```bash
git clone <repo-url> slides-iq
cd slides-iq
npm install
npm run dev
```

The dev server starts with `node --watch server.js`, which restarts automatically when any `.js` file changes. The database file is created at `./data/nexus.db` (or at `DB_PATH` if set).

On first run, the app detects no users exist and redirects to the setup screen at `/#/setup` where you create the initial admin account. After setup, navigate to **Administration → KI-Anbieter** to enter your AI provider API key.

There is no `.env` file required. The only environment variables that affect behaviour are `PORT`, `SESSION_SECRET`, `BASE_URL`, and `DB_PATH` — none of them are required for local development.

---

## Dev vs Production Mode

| | Dev (`npm run dev`) | Production (`npm start`) |
|---|---|---|
| Server restart | Automatic on file change | Manual |
| Error detail | Full stack traces in logs | Same (no env distinction currently) |
| Session secret | Defaults to a random value | Set `SESSION_SECRET` in env |
| HTTPS | Not configured | Use a reverse proxy (see Deployment) |

There is no build step. The frontend is served as static files from `public/` — plain ES modules, no bundler.

---

## Project Structure

```
slides-iq/
├── server.js                  # Express app entry point
├── database.js                # SQLite setup, migrations, seeding
├── middleware/
│   └── auth.js                # requireAuth / requireAdmin
├── routes/
│   ├── auth.js                # /api/auth/*
│   ├── presentations.js       # /api/presentations/*
│   ├── templates.js           # /api/templates/*
│   ├── ai.js                  # /api/ai/*
│   └── admin.js               # /api/admin/*
├── services/
│   ├── aiProvider.js          # Resolves active provider settings from DB
│   ├── claude.js              # Multi-provider AI client + framework helpers
│   ├── pdf.js                 # Puppeteer PDF export
│   ├── fileParser.js          # Multi-format file parsing
│   └── slideUtils.js          # HTML slide manipulation utilities
└── public/
    ├── index.html             # SPA shell
    ├── css/                   # Global stylesheet
    └── js/
        ├── app.js             # Bootstrap
        ├── router.js          # Hash-based SPA router
        ├── api.js             # Centralised fetch wrapper + SSE consumer
        ├── i18n.js            # Translations (en/de/it/nl/pl)
        ├── views/             # One file per page
        ├── components/        # modal.js, toast.js
        └── utils/             # passwordToggle.js, etc.
```

---

## Adding a New View

Views are plain ES modules in `public/js/views/`. Each module exports a `renderXxx(container)` async function that receives the `#view-container` DOM element and populates it.

**Steps:**

1. Create `public/js/views/myView.js`:

```javascript
import { api } from '../api.js';
import { toastError } from '../components/toast.js';

export async function renderMyView(container) {
  container.innerHTML = `<div class="view-header"><h1>My View</h1></div>`;
  try {
    const data = await api.presentations.list();
    // … render data
  } catch (err) {
    toastError(err.message);
  }
}
```

2. Register the route in `public/js/router.js` (or wherever routes are registered in `app.js`):

```javascript
import { renderMyView } from './views/myView.js';
router.register('/my-view', renderMyView);
```

3. Add a navigation link in `public/index.html`:

```html
<a href="#/my-view" class="nav-link" data-route="my-view">My View</a>
```

4. Add i18n keys (see *Adding Translations* below).

---

## Adding a New API Endpoint

**Backend:**

Add the handler to the relevant route file in `routes/`. All route files export an Express `Router`.

```javascript
// In routes/presentations.js (example)
router.get('/:id/summary', requireAuth, (req, res) => {
  const presentation = db.prepare('SELECT id, title, slide_count FROM presentations WHERE id = ?')
    .get(req.params.id);
  if (!presentation) return res.status(404).json({ error: 'Not found' });
  res.json(presentation);
});
```

**Frontend:**

Add the method to the `api` object in `public/js/api.js`:

```javascript
presentations: {
  // existing methods …
  getSummary: (id) => apiFetch(`/presentations/${id}/summary`),
},
```

---

## Adding a New AI Provider

1. Add the provider entry to `PROVIDERS` in `public/js/views/admin.js` (label, models, key placeholder).
2. Add the same provider to `DEFAULT_MODELS` in `services/aiProvider.js`.
3. Add the generation call in `services/claude.js` inside `generatePresentation()` — dispatch on `provider`.
4. Seed the new provider into the default `preferences` settings in `database.js` so existing installs get the new entry on next startup.

---

## Adding Translations

All UI strings live in `public/js/i18n.js`. The file exports a nested `translations` object keyed by locale code.

Supported locales: `en`, `de`, `it`, `nl`, `pl`.

**Steps:**

1. Add the key to every locale in `i18n.js`:

```javascript
en: {
  'myView.heading': 'Welcome',
},
de: {
  'myView.heading': 'Willkommen',
},
// … it, nl, pl
```

2. Use programmatically in JS:

```javascript
import { t } from '../i18n.js';
element.textContent = t('myView.heading');
```

3. Or inline in an HTML template string:

```javascript
container.innerHTML = `<h1>${t('myView.heading')}</h1>`;
```

If a key is missing in the active locale, the i18n module falls back to `en`. If missing in `en` too, the key string itself is displayed.

---

## File Upload Handling

File uploads flow through `services/fileParser.js`. `parseFile(file)` accepts a Multer file object and returns:

| Format | Return shape |
|---|---|
| Plain text / CSV | `{ type: 'text', content: 'string' }` |
| Image (jpg/png/gif/webp) | `{ type: 'image', mediaType: 'image/jpeg', data: 'base64string' }` |
| Excel (.xlsx) | `{ type: 'text', content: 'CSV-like text via ExcelJS' }` |
| Word (.docx) | `{ type: 'text', content: 'plain text via Mammoth' }` |
| PDF | `{ type: 'text', content: 'extracted text via pdf-parse' }` |
| PPTX | `{ type: 'text', content: 'slide text via adm-zip' }` |

Images become vision content blocks in the AI messages array. All other types become text content blocks.

To support a new format:
1. Add a MIME type / extension check in `parseFile()`.
2. Install the required parsing library.
3. Return one of the two shapes above.

---

## Deployment

### Reverse Proxy (Nginx / Caddy)

Run the app behind a reverse proxy to handle TLS. Example minimal Nginx config:

```nginx
server {
  listen 443 ssl;
  server_name slides.example.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;       # Required for WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 300s;                       # Required for SSE streams
  }
}
```

The `proxy_read_timeout` must be long enough to cover the full AI streaming response (generation can take 30–120 seconds for complex presentations).

### Environment Variables for Production

```bash
PORT=3000
SESSION_SECRET=<long random string>   # Required — do not use the default
BASE_URL=https://slides.example.com   # Required for correct share link URLs
DB_PATH=/var/data/nexus.db            # Recommended: persist outside the app directory
```

AI API keys are configured in the **Admin panel** — not in environment variables.

### Trust Proxy

If running behind a reverse proxy, add this to `server.js` (or confirm it is present):

```javascript
app.set('trust proxy', 1);
```

This ensures `express-session` sets the session cookie with `secure: true` correctly when the request arrives over HTTP internally but HTTPS externally.

### Process Management

```bash
# PM2
pm2 start server.js --name slides-iq
pm2 save
pm2 startup
```

Or use a systemd unit file pointing to `node /path/to/server.js`.

### Database Backups

The SQLite file at `DB_PATH` is the single source of truth. Back it up with:

```bash
sqlite3 /var/data/nexus.db ".backup '/var/backups/nexus-$(date +%Y%m%d).db'"
```

Because WAL mode is enabled, a plain file copy while the server is running is safe as long as you also copy the `-wal` and `-shm` sidecar files.
