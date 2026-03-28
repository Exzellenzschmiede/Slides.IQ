# API Reference

All API endpoints are prefixed with `/api`. Requests and responses use JSON unless noted otherwise. Session cookies are used for authentication — include `credentials: 'include'` in browser fetch calls.

**Common error shapes:**

```json
{ "error": "Unauthorized" }          // 401
{ "error": "Forbidden" }             // 403
{ "error": "Not found" }             // 404
{ "error": "Validation message" }    // 400
```

---

## Auth

### GET /api/auth/setup-needed

Returns whether the initial admin setup is required (no users exist yet).

- Auth: None
- Response: `{ "setupNeeded": true | false }`

---

### POST /api/auth/setup

Creates the first admin user. Only works when no users exist.

- Auth: None
- Body: `{ "username": "string", "password": "string" }`
- Response 201: `{ "id": 1, "username": "admin", "role": "admin" }`

---

### POST /api/auth/login

- Auth: None
- Body: `{ "username": "string", "password": "string" }`
- Response 200: `{ "id": 1, "username": "string", "role": "user" | "admin" }`
- Response 401: invalid credentials

---

### POST /api/auth/logout

- Auth: Required
- Body: none
- Response 200: `{ "success": true }`

---

### GET /api/auth/me

Returns the current session user.

- Auth: Required
- Response: `{ "id": 1, "username": "string", "role": "string", "displayName": "string", "language": "en" }`

---

### PUT /api/auth/me

Update current user profile fields.

- Auth: Required
- Body: `{ "displayName": "string", "language": "en" | "de" | "it" | "nl" | "pl" }` (all fields optional)
- Response 200: updated user object

---

### PUT /api/auth/me/password

Change the current user's password.

- Auth: Required
- Body: `{ "currentPassword": "string", "newPassword": "string" }`
- Response 200: `{ "success": true }`
- Response 400: wrong current password

---

### GET /api/auth/users

List all users.

- Auth: Admin
- Response: `[ { "id": 1, "username": "string", "role": "string", "displayName": "string" }, ... ]`

---

### POST /api/auth/users

Create a new user.

- Auth: Admin
- Body: `{ "username": "string", "password": "string", "role": "user" | "admin" }`
- Response 201: user object

---

### DELETE /api/auth/users/:id

Delete a user. Cannot delete yourself.

- Auth: Admin
- Response 200: `{ "success": true }`

---

### PUT /api/auth/users/:id

Update a user's profile fields.

- Auth: Admin
- Body: `{ "displayName": "string", "language": "string" }` (fields optional)
- Response 200: updated user object

---

### PUT /api/auth/users/:id/role

Change a user's role.

- Auth: Admin
- Body: `{ "role": "user" | "admin" }`
- Response 200: `{ "success": true }`

---

### PUT /api/auth/users/:id/password

Reset a user's password (admin action, no old password required).

- Auth: Admin
- Body: `{ "password": "string" }`
- Response 200: `{ "success": true }`

---

## Presentations

All presentation endpoints require authentication. Users can only access presentations they own or have been explicitly shared with.

### GET /api/presentations

List all presentations accessible to the current user (owned + shared).

- Response: `[ { "id": 1, "title": "string", "slideCount": 5, "updatedAt": "ISO8601", "ownerId": 1, "permission": "owner" | "read" | "write" | "delete" }, ... ]`

---

### POST /api/presentations

Create a new empty presentation.

- Body: `{ "title": "string", "templateId": "string" }`
- Response 201: `{ "id": 1, "title": "string", "templateId": "string", "content": "", "createdAt": "ISO8601" }`

---

### GET /api/presentations/:id

Get a single presentation including full HTML content, version list, and conversation history.

- Response:
```json
{
  "id": 1,
  "title": "string",
  "content": "<html>...",
  "templateId": "string",
  "slideCount": 5,
  "versions": [ { "id": 1, "createdAt": "ISO8601", "slideCount": 4 } ],
  "conversation": [ { "role": "user" | "assistant", "content": "string" } ],
  "permission": "owner"
}
```

---

### PUT /api/presentations/:id

Update presentation metadata (title, templateId).

- Auth: write permission or higher
- Body: `{ "title": "string" }` (fields optional)
- Response 200: updated presentation object (without full content)

---

### DELETE /api/presentations/:id

Delete a presentation and all its versions and shares.

- Auth: delete permission or owner
- Response 200: `{ "success": true }`

---

### PUT /api/presentations/:id/content

Replace the full HTML content. Automatically saves the previous content as a version snapshot.

- Auth: write permission or higher
- Body: `{ "content": "<html>..." }`
- Response 200: `{ "success": true, "versionId": 42 }`

---

### POST /api/presentations/:id/restore/:versionId

Restore a previous version. The current content is saved as a new version before restoring.

- Auth: write permission or higher
- Response 200: `{ "success": true, "content": "<html>..." }`

---

### DELETE /api/presentations/:id/slides/:slideIndex

Remove a single slide by its zero-based index.

- Auth: write permission or higher
- Response 200: `{ "success": true, "content": "<html>..." }`

---

### POST /api/presentations/:id/slides/:slideIndex/duplicate

Insert a copy of the slide immediately after the given index.

- Auth: write permission or higher
- Response 200: `{ "success": true, "content": "<html>..." }`

---

### POST /api/presentations/:id/share

Create a public share token (or return the existing one).

- Auth: owner
- Response 200:
```json
{
  "token": "uuid",
  "url": "https://example.com/view/uuid",
  "qrDataUrl": "data:image/png;base64,..."
}
```

---

### DELETE /api/presentations/:id/share

Revoke the public share token.

- Auth: owner
- Response 200: `{ "success": true }`

---

### GET /api/presentations/:id/user-shares

List all per-user shares for this presentation.

- Auth: owner
- Response: `[ { "userId": 2, "username": "string", "permission": "read" | "write" | "delete" } ]`

---

### PUT /api/presentations/:id/user-shares/:userId

Grant or update per-user access.

- Auth: owner
- Body: `{ "permission": "read" | "write" | "delete" }`
- Response 200: `{ "success": true }`

---

### DELETE /api/presentations/:id/user-shares/:userId

Revoke per-user access.

- Auth: owner
- Response 200: `{ "success": true }`

---

### GET /api/presentations/:id/export/pdf

Export the presentation as a PDF file. Renders each slide at 1280×720 using Puppeteer.

- Auth: read permission or higher
- Response: `application/pdf` binary stream with `Content-Disposition: attachment`

---

### GET /api/presentations/:id/export/html

Download the presentation as a self-contained HTML file.

- Auth: read permission or higher
- Response: `text/html` with `Content-Disposition: attachment`

---

## AI Generation

All AI endpoints require authentication and are rate-limited to **10 requests per minute** per session. Generation and edit endpoints use **Server-Sent Events (SSE)**.

### POST /api/ai/upload

Upload a file to use as context for the next generation. The parsed content is stored in the session.

- Body: `multipart/form-data` with field `file`
- Supported formats: PDF, Word, Excel, PPTX, images, plain text, CSV
- Response 200: `{ "id": "uuid", "name": "filename.pdf", "type": "pdf", "size": 12345 }`

---

### POST /api/ai/generate/:presentationId

Generate or update the full presentation via Claude. Streams the response as SSE.

- Body: `{ "prompt": "string", "attachments": [ "upload-id-1", "upload-id-2" ] }`
- SSE event stream:
  - `data: {"type":"chunk","text":"<div class..."}` — partial HTML
  - `data: {"type":"done","slideCount":8}` — generation complete
  - `data: {"type":"error","message":"..."}` — error

---

### POST /api/ai/edit-slide/:presentationId

Replace a single slide using Claude. Streams the replacement HTML as SSE.

- Body: `{ "slideIndex": 2, "instruction": "Make the title larger", "attachments": [] }`
- SSE stream: same shape as generate

---

### POST /api/ai/insert-slide/:presentationId

Generate and insert a new slide at a given position. Streams as SSE.

- Body: `{ "afterIndex": 3, "instruction": "Add a summary slide", "attachments": [] }`
- SSE stream: same shape as generate

---

### POST /api/ai/analyze/:presentationId

Analyze the narrative arc of the presentation (non-streaming).

- Response 200:
```json
{
  "analysis": {
    "arc": "string",
    "strengths": ["..."],
    "weaknesses": ["..."],
    "suggestions": ["..."]
  }
}
```

---

### POST /api/ai/suggest/:presentationId

Get AI improvement suggestions for the presentation (non-streaming).

- Response 200: `{ "suggestions": [ { "slide": 2, "suggestion": "string" } ] }`

---

### GET /api/ai/status

Check API connectivity.

- Response 200: `{ "ok": true, "model": "claude-sonnet-4-6" }`

---

## Templates

### GET /api/templates

List all templates visible to the current user (system templates + user's own + shared).

- Response: `[ { "id": "string", "name": "string", "description": "string", "theme": {...}, "isSystem": true | false, "ownerId": 1 } ]`

---

### POST /api/templates

Create a new template.

- Body:
```json
{
  "name": "string",
  "description": "string",
  "systemPrompt": "string",
  "theme": {
    "primaryColor": "#hex",
    "accentColor": "#hex",
    "bgColor": "#hex",
    "style": "string",
    "font": "string"
  }
}
```
- Response 201: template object

---

### GET /api/templates/:id

Get a single template.

- Response: full template object including `systemPrompt`

---

### PUT /api/templates/:id

Update a template. Owners and admins only.

- Body: any subset of template fields
- Response 200: updated template object

---

### DELETE /api/templates/:id

Delete a template. System templates cannot be deleted. Owners and admins only.

- Response 200: `{ "success": true }`

---

### PUT /api/templates/:id/share

Toggle whether the template is visible to all users.

- Auth: owner or admin
- Body: `{ "shared": true | false }`
- Response 200: `{ "success": true }`

---

### POST /api/templates/from-pptx

Analyze a PPTX file and return a suggested template object (does not save).

- Body: `multipart/form-data` with field `file` (PPTX)
- Response 200: template suggestion object (same shape as POST /api/templates body)

---

## Settings

### GET /api/settings

Get all settings for the current user.

- Response:
```json
{
  "brandName": "string",
  "brandColors": { "primary": "#hex", "accent": "#hex" },
  "brandFont": "string",
  "logoUrl": "string",
  "autoSave": true,
  "language": "en"
}
```

---

### PUT /api/settings

Update settings. All fields optional; unspecified fields are unchanged.

- Body: any subset of settings fields
- Response 200: updated settings object

---

## Admin

### POST /api/admin/migrate-frameworks

Re-inject the current `PRESENTATION_FRAMEWORK` block into every presentation in the database. Useful after a framework update.

- Auth: Admin
- Response 200: `{ "success": true, "updated": 42 }`

---

## Public

### GET /view/:token

Serve a publicly shared presentation (no auth required).

- Path param: `token` — UUID from the share link
- Response 200: full HTML of the presentation, served as `text/html`
- Response 404: token not found or revoked
