# Presentation HTML Format

Every presentation stored in Slides.IQ is a **self-contained HTML file**. It can be opened directly in a browser without a server. This document describes the structure, conventions, and the injected navigation framework.

---

## HTML Structure Overview

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Title</title>
  <style>
    /* Theme CSS authored by the AI */
  </style>
</head>
<body>

  <div id="nexus-presentation">

    <div class="slide" data-notes="Optional speaker notes for slide 1">
      <!-- Slide 1 content -->
    </div>

    <div class="slide" data-notes="Notes for slide 2">
      <!-- Slide 2 content -->
    </div>

    <!-- … more slides … -->

  </div>

  <!-- SLIDESIQ:FRAMEWORK:START -->
  <style>/* Navigation CSS */</style>
  <script>/* Navigation JS */</script>
  <!-- SLIDESIQ:FRAMEWORK:END -->

</body>
</html>
```

---

## SLIDESIQ:FRAMEWORK Markers

The navigation engine is wrapped in a pair of HTML comments:

```html
<!-- SLIDESIQ:FRAMEWORK:START -->
… framework CSS and JS …
<!-- SLIDESIQ:FRAMEWORK:END -->
```

These markers serve two purposes:

1. **Injection:** `injectFramework(html)` in `services/claude.js` searches for these markers. If absent, it inserts the current framework block before `</body>`. If present, it replaces the existing block with the current version.
2. **Stripping:** `stripFramework(html)` removes everything between (and including) the markers before sending HTML to the AI for editing. This prevents the AI from seeing or modifying framework code.

Never manually edit content between these markers — it will be overwritten on the next server start or content update.

---

## `nexus-presentation` and Slide Conventions

The outermost container must have `id="nexus-presentation"`:

```html
<div id="nexus-presentation">
```

The framework JavaScript queries this element at runtime to discover and manage slides.

Each slide is a direct child `<div>` with class `slide`:

```html
<div class="slide">
  <!-- arbitrary HTML content -->
</div>
```

Rules:
- Only direct children of `#nexus-presentation` with `class="slide"` are treated as slides.
- Slides are zero-indexed internally but displayed as 1-based to users.
- There is no enforced limit on the number of slides, but generation typically produces 8–20.

---

## Speaker Notes

Attach speaker notes to any slide via the `data-notes` attribute:

```html
<div class="slide" data-notes="Key point: emphasise the 50% cost reduction figure.">
```

- Notes are plain text; no HTML inside the attribute value.
- The framework reads this attribute and displays notes in the speaker notes panel (toggled with **N**).
- Notes are not visible in the main slide view or in the PDF export.

---

## CSS Custom Properties

Templates define CSS custom properties on `:root` that provide the colour scheme and typography. The AI is instructed to use these variables so that the visual style is consistent and changeable via template settings.

| Property | Description |
|---|---|
| `--primary` | Primary brand/accent colour (buttons, headings) |
| `--accent` | Secondary accent colour (highlights, borders) |
| `--bg` | Slide background colour |
| `--text` | Primary text colour |
| `--font` | Font family stack |

Example (in the slide `<style>` block):

```css
:root {
  --primary: #6c63ff;
  --accent:  #ff6584;
  --bg:      #0d0d1a;
  --text:    #f0f0ff;
  --font:    'Inter', sans-serif;
}
```

Individual slides may define additional local variables or override these per-slide.

---

## PRESENTATION_FRAMEWORK: The Navigation Engine

The `PRESENTATION_FRAMEWORK` constant in `services/claude.js` contains the full CSS and JavaScript that turns the static HTML into an interactive slideshow. It is injected into every presentation automatically.

### Navigation Controls

The framework renders a minimal HUD overlaid on the presentation:

- Previous / Next arrow buttons (bottom corners)
- Slide counter (`3 / 12`)
- Fullscreen toggle button
- Overview grid button
- Speaker notes toggle button

### Keyboard Shortcuts

| Key | Action |
|---|---|
| Arrow Right / Space | Next slide |
| Arrow Left | Previous slide |
| Arrow Up | Jump to first slide |
| Arrow Down | Jump to last slide |
| **N** | Toggle speaker notes panel |
| **O** | Toggle overview grid |
| **F** | Toggle fullscreen |
| **1** – **9** | Jump to slide 1–9 |

### Touch Support

Swipe left → next slide. Swipe right → previous slide. Touch detection uses `touchstart` / `touchend` with a minimum swipe distance threshold to prevent accidental navigation.

### Overview Grid

Pressing **O** tiles all slides in a scrollable grid. Clicking a tile jumps to that slide and exits the overview.

---

## Viewport Scaling: 1280×720 Base

Slides are authored at a fixed 1280×720 px canvas. The framework applies a CSS `transform: scale()` to fit the canvas into the available browser viewport while preserving the 16:9 aspect ratio. A `ResizeObserver` keeps the scale in sync whenever the container changes size (window resize, fullscreen toggle, split-pane resize).

```javascript
function scaleSlides() {
  const rect = wrapper.getBoundingClientRect();
  const scaleX = rect.width  / 1280;
  const scaleY = rect.height / 720;
  const scale  = Math.min(scaleX, scaleY);
  container.style.transform       = `scale(${scale})`;
  container.style.transformOrigin = 'top left';
  container.style.left = `${(rect.width  - 1280 * scale) / 2}px`;
  container.style.top  = `${(rect.height - 720  * scale) / 2}px`;
}
```

This means:
- All pixel values in slide CSS are relative to the 1280×720 viewport — use them freely.
- Font sizes, padding, and layout scale proportionally on any screen.
- The PDF export renders each slide at exactly 1280×720 before assembling to multi-page PDF.

---

## Framework Injection and Stripping

### `injectFramework(html)`

Called in `routes/presentations.js` after every content update and in `server.js` at startup (migration):

1. Strips any existing framework block.
2. Appends the current `PRESENTATION_FRAMEWORK` constant before `</body>`.
3. Returns the updated HTML string.

### `stripFramework(html)`

Called in `routes/ai.js` before building the AI messages for slide editing:

1. Finds the `<!-- SLIDESIQ:FRAMEWORK:START -->` … `<!-- SLIDESIQ:FRAMEWORK:END -->` block using a regex.
2. Removes it entirely.
3. Returns the stripped HTML.

This keeps the AI context clean — the AI never receives framework code and therefore cannot accidentally modify or duplicate it.

---

## How the AI Is Instructed to Generate Slides

The system prompt passed to the AI (built in `buildSystemPrompt()`) contains:

1. **Role instructions** — the AI is told it is a presentation designer and must output only valid HTML.
2. **Structural rules** — must use `<div id="nexus-presentation">` as the outermost wrapper; each slide must be `<div class="slide">`.
3. **CSS variables** — instructed to define `--primary`, `--accent`, `--bg`, `--text`, `--font` on `:root`.
4. **No framework code** — explicitly told not to add navigation, keyboard handlers, or script tags beyond slide content.
5. **Template system prompt** — the selected template's `system_prompt` field is prepended, providing style, tone, and layout guidance specific to that template.
6. **Brand overrides** — if the user has brand settings (colours, font, name), these are appended as additional constraints.
7. **The full `PRESENTATION_FRAMEWORK` block** — included in the system prompt as reference so the AI understands what will be injected, though it is instructed not to reproduce it.

The AI outputs only the `<html>` … `</html>` block with slides; the framework is then injected by the server before saving.
