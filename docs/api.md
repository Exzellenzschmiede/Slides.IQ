# API Reference

All endpoints are prefixed with `/api`. Requests and responses use JSON unless noted. Authentication uses session cookies — include `credentials: 'include'` in browser fetch calls.

**Common error shapes:**

```json
{ "error": "Nicht angemeldet" }        // 401
{ "error": "Kein Zugriff" }            // 403
{ "error": "Not found" }               // 404
{ "error": "Validation message" }      // 400
```

---

## Auth — `/api/auth`

### GET /api/auth/setup-needed

Returns whether the initial admin setup is required (no users exist yet).

- Auth: None
- Response: `{ "setupNeeded": true | false }`

---

### POST /api/auth/setup

Creates the first admin user. Only works when no users exist.

- Auth: None
- Body: `{ "name": "string", "email": "string", "password": "string" }`
- Response 200: `{ "id": "uuid", "email": "string", "name": "string", "role": "admin" }`
- Response 403: setup already completed

---

### POST /api/auth/login

- Auth: None
- Body: `{ "email": "string", "password": "string" }`
- Response 200: `{ "id": "uuid", "email": "string", "name": "string", "role": "user" | "admin" }`
- Response 401: invalid credentials
- Response 403: account deactivated

---

### POST /api/auth/logout

- Auth: Required
- Body: none
- Response 200: `{ "ok": true }`

---

### GET /api/auth/me

Returns the current session user.

- Auth: Required
- Response: `{ "id": "uuid", "email": "string", "name": "string", "role": "string" }`

---

### PUT /api/auth/me

Update current user's name and email.

- Auth: Required
- Body: `{ "name": "string", "email": "string" }`
- Response 200: `{ "ok": true, "name": "string", "email": "string" }`
- Response 409: email already taken

---

### PUT /api/auth/me/password

Change the current user's own password.

- Auth: Required
- Body: `{ "currentPassword": "string", "newPassword": "string" }`
- Response 200: `{ "ok": true }`
- Response 401: wrong current password

---

### GET /api/auth/users

List all users.

- Auth: Admin
- Response: `[ { "id": "uuid", "email": "string", "name": "string", "role": "string", "is_active": 1 | 0, "created_at": "ISO8601" } ]`

---

### POST /api/auth/users

Create a new user.

- Auth: Admin
- Body: `{ "name": "string", "email": "string", "password": "string", "role": "user" | "admin" }`
- Response 201: `{ "id": "uuid", "email": "string", "name": "string", "role": "string" }`
- Response 409: email already taken

---

### PUT /api/auth/users/:id

Update a user's name, email, and optionally role.

- Auth: Admin
- Body: `{ "name": "string", "email": "string", "role?": "user" | "admin" }`
- Response 200: `{ "ok": true }`

---

### PUT /api/auth/users/:id/active

Toggle a user's active/deactivated state.

- Auth: Admin (cannot deactivate yourself)
- Body: none
- Response 200: `{ "ok": true, "is_active": 1 | 0 }`

---

### PUT /api/auth/users/:id/role

Change a user's role.

- Auth: Admin (cannot change your own role)
- Body: `{ "role": "user" | "admin" }`
- Response 200: `{ "ok": true, "role": "string" }`

---

### PUT /api/auth/users/:id/password

Reset a user's password (no old password required).

- Auth: Admin
- Body: `{ "password": "string" }` (min. 8 characters)
- Response 200: `{ "ok": true }`

---

### DELETE /api/auth/users/:id

Delete a user. Cannot delete yourself.

- Auth: Admin
- Response 200: `{ "ok": true }`

---

## Presentations — `/api/presentations`

All presentation endpoints require authentication. Users can only access presentations they own or have been explicitly shared with.

### GET /api/presentations

List all presentations accessible to the current user (owned + shared-with-me).

- Query params: any key passed as `URLSearchParams` (for future filtering)
- Response: array of presentation summary objects

---

### POST /api/presentations

Create a new empty presentation.

- Body: `{ "title": "string", "templateId?": "string" }`
- Response 201: presentation object

---

### GET /api/presentations/:id

Get a single presentation including full HTML content.

- Response: full presentation object with `html_content`, `versions`, `conversation`, `share_token`

---

### PUT /api/presentations/:id

Update presentation metadata (title, description, tags, brand).

- Auth: write permission or owner
- Body: any subset of metadata fields
- Response 200: updated presentation object

---

### DELETE /api/presentations/:id

Delete a presentation and all its shares.

- Auth: owner
- Response 200: `{ "ok": true }`

---

### PUT /api/presentations/:id/content

Replace the full HTML content. Automatically saves the current content as a version snapshot before replacing.

- Auth: write permission or owner
- Body: `{ "html_content": "<html>..." }`
- Response 200: updated presentation object

---

### POST /api/presentations/:id/restore/:versionId

Restore a previous version. The current content is saved as a new version snapshot first.

- Auth: write permission or owner
- Response 200: `{ "ok": true, "html_content": "<html>..." }`

---

### DELETE /api/presentations/:id/slides/:slideIndex

Remove a single slide by zero-based index.

- Auth: write permission or owner
- Response 200: `{ "ok": true, "html_content": "<html>..." }`

---

### POST /api/presentations/:id/slides/:slideIndex/duplicate

Insert a copy of the slide immediately after the given index.

- Auth: write permission or owner
- Response 200: `{ "ok": true, "html_content": "<html>..." }`

---

### POST /api/presentations/:id/share

Create a public share token (or return the existing one).

- Auth: owner
- Response 200: `{ "token": "uuid", "url": "https://...", "qrDataUrl": "data:image/png;base64,..." }`

---

### DELETE /api/presentations/:id/share

Revoke the public share token.

- Auth: owner
- Response 200: `{ "ok": true }`

---

### GET /api/presentations/:id/user-shares

List all per-user shares for this presentation.

- Auth: owner
- Response: `[ { "id": "uuid", "user_id": "uuid", "permission": "read" | "write" | "delete", "created_at": "..." } ]`

---

### PUT /api/presentations/:id/user-shares/:userId

Grant or update per-user access.

- Auth: owner
- Body: `{ "permission": "read" | "write" | "delete" }`
- Response 200: `{ "ok": true }`

---

### DELETE /api/presentations/:id/user-shares/:userId

Revoke per-user access.

- Auth: owner
- Response 200: `{ "ok": true }`

---

### GET /api/presentations/:id/export/pdf

Export the presentation as a PDF. Renders each slide at 1280×720 using Puppeteer.

- Auth: read permission or owner
- Response: `application/pdf` binary with `Content-Disposition: attachment`

---

### GET /api/presentations/:id/export/html

Download the full presentation as a standalone HTML file.

- Auth: read permission or owner
- Response: `text/html` with `Content-Disposition: attachment`

---

## AI — `/api/ai`

All AI endpoints require authentication and are rate-limited to **10 requests per minute** per session. The active AI provider and its API key are read from the global admin settings stored in the database — never from environment variables.

Generation and edit endpoints use **Server-Sent Events (SSE)**.

### GET /api/ai/status

Check that a valid API key is configured for the active provider.

- Response 200: `{ "ok": true, "provider": "anthropic", "model": "claude-sonnet-4-6" }`
- Response 200: `{ "ok": false, "error": "No API key configured" }`

---

### POST /api/ai/upload

Upload a file to use as context for the next generation. Parsed content is stored in the session.

- Body: `multipart/form-data` with field `file`
- Supported formats: PDF, Word (.docx), Excel (.xlsx), PPTX, images (jpg/png/gif/webp), plain text, CSV
- Response 200: `{ "id": "uuid", "name": "filename.pdf", "type": "pdf", "size": 12345 }`

---

### POST /api/ai/generate/:presentationId

Generate or regenerate the full presentation. Streams HTML as SSE.

- Body: `{ "prompt": "string", "attachments": ["upload-id-1"] }`
- SSE stream:
  - `data: {"type":"chunk","text":"<div..."}` — partial HTML chunk
  - `data: {"type":"done","slideCount":8}` — generation complete
  - `data: {"type":"error","message":"..."}` — error (also returned as 400 JSON if no key configured)
- Response 400 (before streaming): `{ "error": "Kein API-Key ..." }` if provider key is missing

---

### POST /api/ai/edit-slide/:presentationId

Replace a single slide using AI. Streams as SSE.

- Body: `{ "slideIndex": 2, "prompt": "Make the title larger" }`
- SSE stream: same shape as generate

---

### POST /api/ai/insert-slide/:presentationId

Generate and insert a new slide at a given position. Streams as SSE.

- Body: `{ "afterIndex": 3, "prompt": "Add a summary slide" }`
- SSE stream: same shape as generate

---

### POST /api/ai/analyze/:presentationId

Analyze the narrative arc of the presentation (non-streaming, Anthropic-only).

- Response 200: `{ "analysis": "string" }`
- Response 400: no API key configured

---

### POST /api/ai/suggest/:presentationId

Get AI improvement suggestions (non-streaming, Anthropic-only).

- Body: `{ "focusArea?": "string" }`
- Response 200: `{ "suggestions": "string" }`

---

## Templates — `/api/templates`

### GET /api/templates

List all templates visible to the current user (system templates + own + shared).

- Response: `[ { "id": "string", "name": "string", "description": "string", "theme": {...}, "owner_id": "uuid" | null, "is_public": 0 | 1 } ]`

---

### POST /api/templates

Create a new template.

- Auth: Required
- Body: `{ "name": "string", "description?": "string", "system_prompt": "string", "theme": { "primaryColor": "#hex", "accentColor": "#hex", "bgColor": "#hex", "style": "string", "font": "string" } }`
- Response 201: template object

---

### GET /api/templates/:id

Get a single template including `system_prompt`.

---

### PUT /api/templates/:id

Update a template. Owner or admin only.

- Body: any subset of template fields

---

### DELETE /api/templates/:id

Delete a template. System templates (`tpl-*`) cannot be deleted. Owner or admin only.

---

### PUT /api/templates/:id/share

Toggle whether the template is visible to all users.

- Auth: owner or admin
- Body: `{ "isPublic": true | false }`
- Response 200: `{ "ok": true }`

---

### POST /api/templates/from-pptx

Analyze a PPTX file and return a suggested template object (does **not** save it).

- Body: `multipart/form-data` with field `file` (PPTX)
- Response 200: template suggestion object (same shape as POST /api/templates body)

---

## Settings — `/api/settings`

Settings are scoped per user. The `brand` and `preferences` keys are the two primary setting objects.

### GET /api/settings

Get all settings for the current user.

- Response: `{ "brand": {...}, "preferences": {...} }`

---

### PUT /api/settings

Update settings. Pass only the top-level keys you want to update.

- Body: `{ "brand?": {...}, "preferences?": {...} }`
- Response 200: `{ "ok": true }`

---

## Admin — `/api/admin`

All admin endpoints require the `admin` role.

### GET /api/admin/ai-settings

Get the global AI provider configuration (shared across all users).

- Response: `{ "aiProvider": "anthropic", "aiProviders": { "anthropic": { "apiKey": "sk-ant-...", "model": "claude-sonnet-4-6" }, "openai": {...}, "mistral": {...}, "gemini": {...} } }`

---

### PUT /api/admin/ai-settings

Update the global AI configuration.

- Body: `{ "aiProvider": "anthropic" | "openai" | "mistral" | "gemini", "aiProviders": { "<provider>": { "apiKey": "string", "model": "string" } } }`
- Response 200: `{ "ok": true }`

---

## Public — No auth required

### GET /view/:token

Serve a publicly shared presentation.

- Path param: `token` — UUID from the share link
- Response 200: full HTML of the presentation (`text/html`)
- Response 404: token not found or revoked
