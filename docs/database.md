# Database

Slides.IQ uses SQLite via the `better-sqlite3` driver. The database file is created automatically on first run at the path configured by `DB_PATH` (default: `./data/nexus.db`).

---

## Connection Settings

Two pragmas are applied immediately after opening the file:

```sql
PRAGMA journal_mode = WAL;     -- Write-Ahead Logging for concurrent reads
PRAGMA foreign_keys = ON;      -- Enforce FK constraints
```

WAL mode allows readers to proceed without blocking writers, which matters for SSE streaming responses that hold the event loop while Claude streams.

---

## Tables

### `users`

Stores all registered accounts.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | Internal user ID |
| `username` | TEXT | NOT NULL, UNIQUE | Login name |
| `password_hash` | TEXT | NOT NULL | bcrypt hash (cost 10) |
| `role` | TEXT | NOT NULL, DEFAULT `'user'` | `'user'` or `'admin'` |
| `display_name` | TEXT | | Friendly display name |
| `language` | TEXT | DEFAULT `'en'` | UI locale (`en`/`de`/`it`/`nl`/`pl`) |
| `created_at` | TEXT | DEFAULT current_timestamp | ISO8601 creation time |

The first user created (via `/api/auth/setup`) is always assigned `role = 'admin'`.

---

### `presentations`

Stores the current state of each presentation.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | Internal presentation ID |
| `user_id` | INTEGER | NOT NULL, FK → users.id | Owner |
| `title` | TEXT | NOT NULL | Display title |
| `content` | TEXT | | Full self-contained HTML of the presentation |
| `template_id` | TEXT | | ID of the template used at creation time |
| `slide_count` | INTEGER | DEFAULT 0 | Cached slide count (updated after each generation) |
| `conversation` | TEXT | | JSON array of `{role, content}` message history |
| `created_at` | TEXT | DEFAULT current_timestamp | |
| `updated_at` | TEXT | DEFAULT current_timestamp | Updated on every content write |

`content` holds the complete HTML including the injected `PRESENTATION_FRAMEWORK` block. `conversation` is kept as serialised JSON; only the last 20 turns are sent to Claude.

---

### `presentation_versions`

Immutable version snapshots. A new row is inserted automatically before every content update.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | Version ID |
| `presentation_id` | INTEGER | NOT NULL, FK → presentations.id | Parent presentation |
| `content` | TEXT | | Full HTML at snapshot time |
| `slide_count` | INTEGER | | Slide count at snapshot time |
| `created_at` | TEXT | DEFAULT current_timestamp | |

Up to 20 versions are retained per presentation. Older versions are purged automatically when the limit is exceeded.

---

### `presentation_shares`

Tracks both public token shares and per-user permission grants.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `presentation_id` | INTEGER | NOT NULL, FK → presentations.id | |
| `share_type` | TEXT | NOT NULL | `'public'` or `'user'` |
| `token` | TEXT | UNIQUE | UUID token (used for `share_type = 'public'`) |
| `user_id` | INTEGER | FK → users.id | Target user (used for `share_type = 'user'`) |
| `permission` | TEXT | | `'read'`, `'write'`, or `'delete'` |
| `created_at` | TEXT | DEFAULT current_timestamp | |

One row with `share_type = 'public'` holds the public link token. Separate rows with `share_type = 'user'` hold per-user grants.

---

### `templates`

Stores both system-seeded and user-created templates.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PK | String ID (system templates use `tpl-*` prefix) |
| `name` | TEXT | NOT NULL | Display name |
| `description` | TEXT | | Short description shown in the gallery |
| `system_prompt` | TEXT | | Instructions prepended to Claude's system prompt |
| `theme` | TEXT | | JSON object: `{primaryColor, accentColor, bgColor, style, font}` |
| `is_system` | INTEGER | DEFAULT 0 | `1` = built-in, cannot be deleted from the UI |
| `owner_id` | INTEGER | FK → users.id | NULL for system templates |
| `is_shared` | INTEGER | DEFAULT 0 | `1` = visible to all users |
| `created_at` | TEXT | DEFAULT current_timestamp | |

#### Seeded system templates

| ID | Name |
|---|---|
| `tpl-cosmic-dark` | Cosmic Dark |
| `tpl-ultraminimal` | Ultraminimal |
| `tpl-neon-terminal` | Neon Terminal |
| `tpl-executive` | Executive Suite |
| `tpl-aurora` | Aurora Gradient |

---

### `slide_library`

Stores individually saved slides that users can reuse across presentations.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `user_id` | INTEGER | NOT NULL, FK → users.id | Owner |
| `title` | TEXT | | Descriptive title |
| `content` | TEXT | | HTML of the single slide `<div>` |
| `thumbnail` | TEXT | | Base64 PNG thumbnail (optional) |
| `tags` | TEXT | | JSON array of tag strings |
| `created_at` | TEXT | DEFAULT current_timestamp | |

---

### `settings`

Key-value settings store, one row per user.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `user_id` | INTEGER | NOT NULL, UNIQUE, FK → users.id | One row per user |
| `brand_name` | TEXT | | Organisation or presenter name |
| `brand_colors` | TEXT | | JSON: `{primary, accent}` |
| `brand_font` | TEXT | | Font family name |
| `logo_url` | TEXT | | URL or base64 data URI |
| `auto_save` | INTEGER | DEFAULT 1 | Boolean as integer |
| `created_at` | TEXT | DEFAULT current_timestamp | |
| `updated_at` | TEXT | DEFAULT current_timestamp | |

A settings row is created automatically (with defaults) the first time a user accesses the settings endpoint.

---

## Relationships

```
users ──< presentations ──< presentation_versions
  |                │
  |                └──< presentation_shares >── users
  |
  ├──< templates
  ├──< slide_library
  └── settings (1:1)
```

- A user owns many presentations, templates, saved slides, and exactly one settings row.
- A presentation has many versions and many shares.
- A share row references either no user (public token) or a specific user (per-user grant).

---

## Indexes

The following indexes are created on startup in addition to primary keys:

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `idx_presentations_user` | presentations | `user_id` | Listing a user's presentations |
| `idx_versions_presentation` | presentation_versions | `presentation_id` | Loading version history |
| `idx_shares_presentation` | presentation_shares | `presentation_id` | Resolving shares on access check |
| `idx_shares_token` | presentation_shares | `token` | `/view/:token` public lookup |
| `idx_shares_user` | presentation_shares | `user_id` | Finding shared-with-me presentations |
| `idx_templates_owner` | templates | `owner_id` | Listing user templates |
| `idx_slide_library_user` | slide_library | `user_id` | Listing saved slides |

---

## Migration Strategy

There is no migration tracking table. All schema changes must be **additive** (add columns, add tables — never drop or rename).

New columns are applied by running:

```sql
ALTER TABLE table_name ADD COLUMN column_name TYPE DEFAULT value;
```

If the column already exists (i.e., the database was already migrated), SQLite raises a `duplicate column name` error. `database.js` catches this error by message string match and silently continues. This means migrations are idempotent and safe to re-run on every startup.

---

## Seeded Defaults

On startup, if the `templates` table is empty, `database.js` inserts the five system templates with their names, descriptions, system prompts, and theme JSON. This seed runs only once (the `IF table is empty` check prevents duplicate seeding).

No other tables receive seed data — user accounts are created through the setup flow or admin UI.
