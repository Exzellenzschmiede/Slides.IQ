# Database

glowwee uses SQLite via the `better-sqlite3` driver. The database file is created automatically on first run at the path configured by `DB_PATH` (default: `./data/nexus.db`).

---

## Connection Settings

Two pragmas are applied immediately after opening the file:

```sql
PRAGMA journal_mode = WAL;   -- Write-Ahead Logging for concurrent reads
PRAGMA foreign_keys = ON;    -- Enforce FK constraints
```

WAL mode allows readers to proceed without blocking writers, which matters for SSE streaming responses that hold the event loop while the AI streams.

---

## Tables

### `users`

Stores all registered accounts.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | UUID (v4) |
| `email` | TEXT | NOT NULL, UNIQUE | Login address |
| `password_hash` | TEXT | NOT NULL | bcrypt hash (cost 12) |
| `name` | TEXT | NOT NULL | Display name shown in the UI |
| `role` | TEXT | NOT NULL, DEFAULT `'user'` | `'user'` or `'admin'` |
| `is_active` | INTEGER | NOT NULL, DEFAULT `1` | `1` = active, `0` = deactivated |
| `created_at` | TEXT | DEFAULT `datetime('now')` | ISO8601 creation time |

The first user created (via `/api/auth/setup`) is always assigned `role = 'admin'`.

---

### `presentations`

Stores the current state of each presentation.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT FK → users.id | Owner |
| `title` | TEXT | Display title |
| `description` | TEXT | Optional description |
| `template_id` | TEXT FK → templates.id | Template used at creation |
| `html_content` | TEXT | Full self-contained HTML including injected framework |
| `slide_count` | INTEGER | Cached count, updated after each generation |
| `conversation` | TEXT | JSON array of `{role, content}` — last 20 turns sent to AI |
| `versions` | TEXT | JSON array of version snapshots (max 20) |
| `share_token` | TEXT UNIQUE | UUID token for public link sharing |
| `view_count` | INTEGER | Public view counter |
| `tags` | TEXT | JSON array of tag strings |
| `brand` | TEXT | JSON snapshot of brand settings at creation time |
| `created_at` | TEXT | |
| `updated_at` | TEXT | Updated on every content write |

`html_content` holds the complete HTML including the injected `PRESENTATION_FRAMEWORK` block. `conversation` is kept as serialised JSON; only the last 20 turns are sent to the AI.

Versions are stored inline as a JSON array in the `versions` column. Each entry: `{ id, html_content, slide_count, created_at }`. Up to 20 are retained; the oldest is dropped when the limit is exceeded.

---

### `presentation_shares`

Tracks per-user permission grants (not public token shares — those use `share_token` on the presentation row).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK UUID | |
| `presentation_id` | TEXT | NOT NULL, FK → presentations.id | |
| `user_id` | TEXT | NOT NULL, FK → users.id | Grantee |
| `permission` | TEXT | NOT NULL, DEFAULT `'read'` | `'read'`, `'write'`, or `'delete'` |
| `created_at` | TEXT | | |
| UNIQUE | | | `(presentation_id, user_id)` |

---

### `templates`

Stores both system-seeded and user-created templates.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | String ID — system templates use `tpl-*` prefix |
| `name` | TEXT | Display name |
| `description` | TEXT | Short description shown in the gallery |
| `preview_html` | TEXT | Small HTML preview rendered in the gallery card |
| `system_prompt` | TEXT | Instructions prepended to the AI system prompt |
| `theme` | TEXT | JSON: `{primaryColor, accentColor, bgColor, style, font}` |
| `owner_id` | TEXT FK → users.id | NULL for system templates |
| `is_public` | INTEGER | `1` = visible to all users |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

#### Seeded system templates

| ID | Name |
|---|---|
| `tpl-cosmic` | Cosmic Dark |
| `tpl-minimal` | Ultraminimal |
| `tpl-neon` | Neon Terminal |
| `tpl-corporate` | Executive Suite |
| `tpl-gradient` | Aurora Gradient |

System templates cannot be deleted from the UI.

---

### `slide_library`

Stores individually saved slides that can be reused across presentations.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `title` | TEXT | |
| `html_content` | TEXT | HTML of the single `<div class="slide">` element |
| `tags` | TEXT | JSON array of tag strings |
| `source_presentation_id` | TEXT FK → presentations.id | Origin presentation (nullable) |
| `created_at` | TEXT | |

---

### `settings`

Key-value settings store, scoped per user. Each row represents one setting key for one user.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `key` | TEXT | PK (composite with user_id) | Setting key, e.g. `brand`, `preferences` |
| `value` | TEXT | NOT NULL | JSON-serialised value |
| `user_id` | TEXT | NOT NULL, DEFAULT `''` | Empty string = global/admin settings |

Global defaults (user_id = `''`) are seeded on first run:

- `brand` — `{name, primaryColor, accentColor, font, style, tagline, tone}`
- `preferences` — `{defaultSlideCount, language, mainModel, aiProvider, aiProviders: {anthropic, openai, mistral, gemini}}`

Each `aiProviders` entry contains `{apiKey, model}`. These are the credentials used for AI generation — they are never read from environment variables.

---

## Relationships

```
users ──< presentations ──< presentation_shares >── users
  │             │
  │             └── versions (inline JSON array)
  │             └── share_token (public link)
  │
  ├──< templates
  ├──< slide_library
  └──< settings (key-per-row, scoped by user_id)
```

---

## Indexes

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `idx_presentations_updated` | presentations | `updated_at DESC` | Default sort in dashboard listing |
| `idx_presentations_share` | presentations | `share_token` | `/view/:token` public lookup |
| `idx_shares_user` | presentation_shares | `user_id` | Listing presentations shared with a user |
| `idx_shares_presentation` | presentation_shares | `presentation_id` | Access check on presentation routes |

---

## Migration Strategy

There is no migration tracking table. All schema changes are **additive** (add columns or tables — never drop or rename).

New columns are applied at startup by running:

```sql
ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT value;
```

If the column already exists SQLite raises a `duplicate column name` error. `database.js` catches this silently and continues. Migrations are therefore idempotent and safe to re-run on every startup.

The `settings` table also has a one-time structural migration: on startup, if the table uses the old single-column primary key, it is rebuilt with a composite `(key, user_id)` primary key and existing data is preserved.
