# Development Guide

---

## Project Setup

```bash
git clone <repo-url> slides-iq
cd slides-iq
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY
npm install
npm run dev
```

The dev server starts with `node --watch server.js`, which restarts automatically when any `.js` file changes. The database file is created at `./data/nexus.db` (or at `DB_PATH` if set).

On first run, the app detects no users exist and redirects to the setup screen at `/#/setup` where you create the initial admin account.

---

## Dev vs Production Mode

| | Dev (`npm run dev`) | Production (`npm start`) |
|---|---|---|
| Server restart | Automatic on file change | Manual |
| Error detail | Full stack traces in logs | Same (no env distinction currently) |
| Session secret | Defaults to a random value | Set `SESSION_SECRET` in `.env` |
| HTTPS | Not configured | Use a reverse proxy (see Deployment) |

There is no build step. The frontend is served as static files from `public/` — plain ES modules, no bundler.

---

## Adding a New View

Views are plain ES modules in `public/js/views/`. Each module exports two functions: `render(params)` returns an HTML string, and `init(params)` binds event listeners and loads data.

**Steps:**

1. Create `public/js/views/myView.js`:

```javascript
// public/js/views/myView.js
import { api } from '../api.js';
import { showToast } from '../components/toast.js';

export function render(params) {
  return `
    <div class="view-container">
      <h1>My View</h1>
      <div id="my-content">Loading...</div>
    </div>
  `;
}

export async function init(params) {
  const data = await api.myResource.list();
  document.getElementById('my-content').textContent = JSON.stringify(data);
}
```

2. Register the route in `public/js/app.js`:

```javascript
import { render as myViewRender, init as myViewInit } from './views/myView.js';

// Inside the router registration block:
router.register('/my-view', myViewRender, myViewInit);
// With params: router.register('/my-view/:id', myViewRender, myViewInit);
```

3. Add a navigation link in `public/index.html` (inside the `<nav>` element):

```html
<a href="#/my-view" class="nav-link" data-i18n="nav.myView">My View</a>
```

4. Add the i18n key to all locales (see Adding Translations below).

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

Add the corresponding method to the `api` object in `public/js/api.js`:

```javascript
// In the api object, under the relevant namespace:
presentations: {
  // ... existing methods ...
  getSummary: (id) => apiFetch(`/presentations/${id}/summary`),
},
```

Then call it from a view:

```javascript
const summary = await api.presentations.getSummary(presentationId);
```

---

## Adding Translations

All UI strings live in `public/js/i18n.js`. The file exports a `translations` object keyed by locale code, each containing a flat map of `key: "string"` pairs.

Supported locales: `en`, `de`, `it`, `nl`, `pl`.

**Steps:**

1. Open `public/js/i18n.js` and add the key to every locale:

```javascript
const translations = {
  en: {
    // existing keys ...
    'nav.myView': 'My View',
    'myView.heading': 'Welcome to My View',
  },
  de: {
    'nav.myView': 'Meine Ansicht',
    'myView.heading': 'Willkommen in meiner Ansicht',
  },
  it: {
    'nav.myView': 'La mia vista',
    'myView.heading': 'Benvenuto nella mia vista',
  },
  nl: {
    'nav.myView': 'Mijn weergave',
    'myView.heading': 'Welkom in mijn weergave',
  },
  pl: {
    'nav.myView': 'Mój widok',
    'myView.heading': 'Witaj w moim widoku',
  },
};
```

2. Use the key in HTML via the `data-i18n` attribute (automatically resolved by the i18n init code in `app.js`):

```html
<h1 data-i18n="myView.heading">My View</h1>
```

3. Or use it programmatically in JS:

```javascript
import { t } from '../i18n.js';
element.textContent = t('myView.heading');
```

If a key is missing in the active locale, the i18n module falls back to the `en` value. If missing in `en` too, the key string itself is displayed.

---

## File Upload Handling

File uploads flow through `services/fileParser.js`. The `parseFile(file)` function accepts a Multer file object and returns a parsed representation:

| Format | Return shape |
|---|---|
| Plain text / CSV | `{ type: 'text', content: 'string' }` |
| Image (jpg/png/gif/webp) | `{ type: 'image', mediaType: 'image/jpeg', data: 'base64string' }` |
| Excel (.xlsx) | `{ type: 'text', content: 'CSV-like text extracted by ExcelJS' }` |
| Word (.docx) | `{ type: 'text', content: 'plain text extracted by Mammoth' }` |
| PDF | `{ type: 'text', content: 'extracted text via pdf-parse' }` |
| PPTX | `{ type: 'text', content: 'slide text extracted via adm-zip' }` |

Images become vision content blocks in the Claude messages array. All other types become text content blocks.

To support a new file format:

1. Add a MIME type / extension check in the dispatch block of `parseFile()`.
2. Install the required parsing library (`npm install <lib>`).
3. Return one of the two shapes above.

---

## Deployment Notes

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

The `proxy_read_timeout` must be long enough to cover the full Claude streaming response (generation can take 30–120 seconds for complex presentations).

### Environment Variables for Production

```bash
NODE_ENV=production
PORT=3000
SESSION_SECRET=<long random string>   # Required — do not use the default
BASE_URL=https://slides.example.com   # Required for correct share link URLs
DB_PATH=/var/data/nexus.db            # Recommended: persist outside the app directory
ANTHROPIC_API_KEY=sk-ant-...
```

### Trust Proxy

If running behind a reverse proxy, add this to `server.js` (or confirm it is present):

```javascript
app.set('trust proxy', 1);
```

This ensures `express-session` sets the session cookie with `secure: true` correctly when the request arrives over HTTP internally but HTTPS externally.

### Process Management

Use a process manager to keep the server running:

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
