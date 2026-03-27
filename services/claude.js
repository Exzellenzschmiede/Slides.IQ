'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// ─── Core presentation generation system prompt ────────────────────────────

const FRAMEWORK_START = '<!-- SLIDESIQ:FRAMEWORK:START -->';
const FRAMEWORK_END   = '<!-- SLIDESIQ:FRAMEWORK:END -->';

const PRESENTATION_FRAMEWORK = `${FRAMEWORK_START}
<style id="nexus-engine-styles">
/* ═══ SLIDES.IQ PRESENTATION ENGINE (embedded) ═══ */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 100%; height: 100%; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
body { font-family: var(--font, 'Inter', system-ui, sans-serif); background: var(--bg, #05070f); color: var(--text, #e2e8f0); }

#nexus-presentation {
  position: relative;
  width: 1280px; height: 720px;
  overflow: hidden; flex-shrink: 0;
  transform-origin: center center;
}

/* High-specificity rules so Claude's generated CSS cannot override show/hide */
#nexus-presentation .slide {
  position: absolute !important; inset: 0 !important;
  display: flex; align-items: center; justify-content: center;
  opacity: 0 !important; pointer-events: none !important;
  transform: translateX(60px) scale(0.97) !important;
  transition: opacity 0.5s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1);
  padding: 4rem; overflow: hidden;
}
#nexus-presentation .slide.active {
  opacity: 1 !important; pointer-events: all !important;
  transform: translateX(0) scale(1) !important;
  z-index: 1;
}
#nexus-presentation .slide.prev {
  opacity: 0 !important; pointer-events: none !important;
  transform: translateX(-60px) scale(0.97) !important;
}
.slide.overview-item {
  position: static !important;
  transform: none !important;
  opacity: 1 !important;
  pointer-events: all !important;
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s, transform 0.2s;
  aspect-ratio: 16/9;
  scale: 1;
}
.slide.overview-item:hover { transform: scale(1.02); border-color: var(--primary, #7c3aed); }
.slide.overview-item.active-ov { border-color: var(--accent, #06b6d4); }

#nexus-controls {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 1000;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 24px;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(12px);
  opacity: 0;
  transition: opacity 0.3s;
}
#nexus-controls:hover, #nexus-controls.always-visible { opacity: 1; }
body:has(#nexus-controls:hover) #nexus-controls { opacity: 1; }
#nexus-presentation:hover ~ #nexus-controls { opacity: 1; }

#progress-bar { flex: 1; height: 3px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden; }
#progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary,#7c3aed), var(--accent,#06b6d4)); border-radius: 2px; transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }
#slide-counter { font-size: 12px; color: rgba(255,255,255,0.5); min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
.ctrl-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.7); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s; }
.ctrl-btn:hover { background: rgba(255,255,255,0.2); color: white; }
#nav-dots { display: flex; gap: 6px; align-items: center; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.25); border: none; cursor: pointer; transition: all 0.3s; padding: 0; }
.dot.active { background: var(--accent, #06b6d4); transform: scale(1.4); }

#speaker-notes-panel {
  position: fixed; bottom: 60px; left: 0; right: 0; z-index: 999;
  background: rgba(0,0,0,0.9); backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255,255,255,0.1);
  padding: 16px 24px; max-height: 200px; overflow-y: auto;
  transform: translateY(100%); transition: transform 0.3s;
  display: none;
}
#speaker-notes-panel.visible { transform: translateY(0); display: block; }
#speaker-notes-panel h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent,#06b6d4); margin-bottom: 8px; }
#speaker-notes-panel p { font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.8); }

#overview-panel {
  position: fixed; inset: 0; z-index: 998;
  background: rgba(0,0,0,0.95); backdrop-filter: blur(20px);
  padding: 60px 40px;
  display: none; overflow-y: auto;
}
#overview-panel.visible { display: block; }
#overview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.overview-slide-wrapper { position: relative; aspect-ratio: 16/9; background: var(--bg, #05070f); border-radius: 8px; overflow: hidden; border: 2px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s; }
.overview-slide-wrapper:hover { border-color: var(--primary,#7c3aed); transform: translateY(-2px); }
.overview-slide-wrapper.active-ov { border-color: var(--accent,#06b6d4); }
.overview-slide-wrapper iframe { width: 400%; height: 400%; transform: scale(0.25); transform-origin: top left; pointer-events: none; border: none; }
.overview-slide-label { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); color: rgba(255,255,255,0.6); font-size: 11px; padding: 2px 8px; border-radius: 4px; }
#overview-close { position: fixed; top: 20px; right: 24px; z-index: 999; }
</style>

<div id="nexus-controls" class="always-visible">
  <button class="ctrl-btn" id="btn-prev" title="Previous (←)">←</button>
  <div id="progress-bar"><div id="progress-fill"></div></div>
  <div id="nav-dots"></div>
  <span id="slide-counter">1 / 1</span>
  <button class="ctrl-btn" id="btn-next" title="Next (→)">→</button>
  <button class="ctrl-btn" id="btn-notes" title="Speaker Notes (N)">📝</button>
  <button class="ctrl-btn" id="btn-overview" title="Overview (O)">⊞</button>
  <button class="ctrl-btn" id="btn-fs" title="Fullscreen (F)">⛶</button>
</div>

<div id="speaker-notes-panel">
  <h4>Speaker Notes</h4>
  <p id="notes-text">—</p>
</div>

<div id="overview-panel">
  <button class="ctrl-btn" id="overview-close" style="position:fixed;top:20px;right:24px;z-index:9999">✕ Schließen</button>
  <div id="overview-grid"></div>
</div>

<script>
(function() {
  // Find slides — try scoped first, fall back to global search
  let slides = Array.from(document.querySelectorAll('#nexus-presentation .slide'));
  if (!slides.length) slides = Array.from(document.querySelectorAll('.slide'));
  let current = 0;

  function goto(n, skipAnimation) {
    if (n < 0 || n >= slides.length) return;
    slides[current].classList.remove('active');
    slides[current].classList.add('prev');
    current = n;
    slides.forEach((s, i) => { if (i !== current) s.classList.remove('active'); });
    slides[current].classList.remove('prev');
    slides[current].classList.add('active');
    requestAnimationFrame(updateUI);
    // Notify parent (if embedded in app)
    try { window.parent.postMessage({ type: 'nexus-slide', index: current, total: slides.length, notes: slides[current].dataset.notes || '' }, '*'); } catch(e){}
  }

  function updateUI() {
    const fill = document.getElementById('progress-fill');
    const counter = document.getElementById('slide-counter');
    const notesText = document.getElementById('notes-text');
    if (fill) fill.style.width = slides.length > 1 ? ((current / (slides.length - 1)) * 100) + '%' : '100%';
    if (counter) counter.textContent = (current + 1) + ' / ' + slides.length;
    if (notesText) notesText.textContent = slides[current].dataset.notes || '—';
    document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === current));
    document.querySelectorAll('.overview-slide-wrapper').forEach((w, i) => w.classList.toggle('active-ov', i === current));
  }

  // Keyboard
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goto(current + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goto(current - 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); goto(0); }
    if (e.key === 'ArrowDown') { e.preventDefault(); goto(slides.length - 1); }
    if (e.key === 'n' || e.key === 'N') toggleNotes();
    if (e.key === 'o' || e.key === 'O') toggleOverview();
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'Escape') { closeOverview(); }
    // Number keys
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= slides.length) goto(num - 1);
  });

  // Touch
  let touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      if (dx < 0) goto(current + 1); else goto(current - 1);
    }
  }, { passive: true });

  // Buttons
  document.getElementById('btn-prev')?.addEventListener('click', () => goto(current - 1));
  document.getElementById('btn-next')?.addEventListener('click', () => goto(current + 1));
  document.getElementById('btn-notes')?.addEventListener('click', toggleNotes);
  document.getElementById('btn-overview')?.addEventListener('click', toggleOverview);
  document.getElementById('btn-fs')?.addEventListener('click', toggleFullscreen);
  document.getElementById('overview-close')?.addEventListener('click', closeOverview);

  // Nav dots
  const dotsContainer = document.getElementById('nav-dots');
  if (dotsContainer) {
    slides.forEach(function(_, i) {
      const dot = document.createElement('button');
      dot.className = 'dot';
      dot.title = 'Slide ' + (i + 1);
      dot.addEventListener('click', function() { goto(i); });
      dotsContainer.appendChild(dot);
    });
  }

  // Overview
  function buildOverview() {
    const grid = document.getElementById('overview-grid');
    if (!grid || grid.children.length > 0) return;
    slides.forEach(function(slide, i) {
      const wrapper = document.createElement('div');
      wrapper.className = 'overview-slide-wrapper' + (i === current ? ' active-ov' : '');
      wrapper.innerHTML = '<div style="width:100%;height:100%;overflow:hidden;pointer-events:none">' + slide.outerHTML + '</div><span class="overview-slide-label">' + (i + 1) + '</span>';
      wrapper.querySelector('.slide').style.cssText = 'position:static;transform:none;opacity:1;pointer-events:none;width:100%;height:100%;padding:8px;font-size:6px;';
      wrapper.addEventListener('click', function() { goto(i); closeOverview(); });
      grid.appendChild(wrapper);
    });
  }

  function toggleOverview() {
    const panel = document.getElementById('overview-panel');
    if (!panel) return;
    buildOverview();
    panel.classList.toggle('visible');
  }
  function closeOverview() {
    document.getElementById('overview-panel')?.classList.remove('visible');
  }

  function toggleNotes() {
    document.getElementById('speaker-notes-panel')?.classList.toggle('visible');
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function(){});
    } else {
      document.exitFullscreen();
    }
  }

  // Listen for parent messages (presenter remote control)
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'nexus-goto') goto(e.data.index);
    if (e.data && e.data.type === 'nexus-next') goto(current + 1);
    if (e.data && e.data.type === 'nexus-prev') goto(current - 1);
  });

  // Viewport scaling — always render at 1280×720, scale to fit
  function scalePresentation() {
    var pres = document.getElementById('nexus-presentation');
    if (!pres) return;
    var controlsH = document.getElementById('nexus-controls') ? 56 : 0;
    var scale = Math.min(window.innerWidth / 1280, (window.innerHeight - controlsH) / 720);
    pres.style.transform = 'scale(' + scale + ')';
  }
  scalePresentation();
  window.addEventListener('resize', scalePresentation);

  // Init
  goto(0);
})();
</script>
${FRAMEWORK_END}
`;

// ─── System prompt builder ────────────────────────────────────────────────

function buildSystemPrompt(templateSystemPrompt, brand) {
  const brandSection = brand && Object.keys(brand).length > 0 ? `
## Brand Identity (MUST BE APPLIED)
${JSON.stringify(brand, null, 2)}
Integriere diese Brand-Elemente konsistent in jede Präsentation.
` : '';

  return `Du bist Slides.IQ — ein weltklasse AI-Präsentationsarchitekt. Du erstellst atemberaubende, vollständig eigenständige HTML-Präsentationen die Kunst und Technologie verbinden.

${templateSystemPrompt}

${brandSection}

## ⚠️ VOLLSTÄNDIGKEIT — OBERSTE PRIORITÄT

BEVOR du anfängst: Plane die genaue Anzahl der Slides und schätze die Ausgabelänge. Halte dich daran:
- CSS KOMPAKT schreiben — maximal 1 @keyframes-Block, keine Redundanzen, keine langen Kommentare
- Lieber 2 visuelle Effekte weniger als eine fehlende Slide
- Jede Slide MUSS vollständig abgeschlossen sein (öffnender und schließender </div>)
- Das letzte Element deiner Ausgabe MUSS </body></html> sein
- Starte die Slides SOFORT nach dem </style> — kein unnötiger Whitespace

## TECHNISCHE ANFORDERUNGEN

### HTML-Struktur — EXAKT SO (keine Abweichungen):

KRITISCHE REGELN:
1. Jede Slide ist ein direktes Kind-Element von <div id="nexus-presentation">
2. Jede Slide hat GENAU class="slide" (erste zusätzlich class="slide active")
3. Das Navigations-Framework wird automatisch injiziert — du musst NICHTS dafür tun
4. KEIN eigenes JavaScript für Navigation/Slideshow schreiben
5. KEINE eigene Show/Hide-Logik für Slides

Minimales Grundgerüst:

<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Titel</title>
  <style>
    /* Dein komplettes CSS hier — ABER NICHT: position/opacity/transform für .slide */
    :root { --primary: #7c3aed; --accent: #06b6d4; --bg: #05070f; }
    body { margin: 0; background: var(--bg); }
    /* Slide-Inhalte stylen, aber nicht die Slides selbst positionieren */
    .slide-content { width: 100%; max-width: 1100px; }
  </style>
</head>
<body>
  <div id="nexus-presentation">

    <div class="slide active" data-notes="Speaker Notes Slide 1">
      <div class="slide-content">
        <!-- Inhalt Slide 1 -->
      </div>
    </div>

    <div class="slide" data-notes="Speaker Notes Slide 2">
      <div class="slide-content">
        <!-- Inhalt Slide 2 -->
      </div>
    </div>

    <!-- Weitere Slides mit class="slide" ... -->

  </div>
</body>
</html>

### Slide-Typen die du variieren sollst:
1. **Title Slide** — Großes Impact-Opening, Name + Tagline
2. **Problem/Opportunity** — Das "Warum" visuell erzählen
3. **Content Slides** — Verschiedene Layouts: Split, Cards, Timeline, Grid
4. **Data/Stats Slides** — Zahlen visuell dramatisieren (große Typografie, animated counters)
5. **Quote Slides** — Typografie-fokussiert, atmosphärischer Background
6. **Visual Concept Slides** — Abstrakte visuelle Metaphern mit CSS
7. **Code Slides** — Syntax-highlighted Code-Blocks mit Terminal-Ästhetik
8. **Transition Slides** — Kapitelüberschriften, Pausen im Narrativ
9. **Call-to-Action** — Starkes, unvergessliches Closing

### CSS-Techniken (mindestens 60% anwenden):
- CSS Custom Properties (--primary, --accent, --bg, --text, --font)
- backdrop-filter: blur() für Glasmorphismus
- CSS @keyframes Entrance-Animationen (fade in, slide up, scale)
- clip-path für kreative Formen
- CSS Grid und Flexbox
- Gradient-Texte mit background-clip: text
- mix-blend-mode für künstlerische Effekte
- CSS-Variablen für kohärentes Theming
- box-shadow mit Color für Glow-Effekte

### Interaktive Elemente:
- Hover-Effekte auf wichtigen Elementen
- Animated Counters für Statistiken (Intersection Observer + CSS)
- Tabbed Content wo sinnvoll
- Expandable Sections

### Speaker Notes (PFLICHT):
Jede Slide MUSS ein data-notes Attribut mit ausführlichen Speaker Notes haben.
Format: "Kernbotschaft dieser Slide. Was betonen? Übergangssatz zur nächsten Slide."

### Qualitätsstandards:
- Jede Slide ist visuell einzigartig aber kohärent im Gesamtstil
- Mindestens 6, maximal 12 Slides — plane realistisch, Vollständigkeit vor Quantität
- Text: kurz, prägnant, impactvoll (kein Wall of Text)
- Typografische Hierarchie (H1 > H2 > Body)
- Visuelle "Aha-Momente" — mindestens einer pro 3 Slides

## AUSGABE
Gib NUR den vollständigen HTML-Code zurück. Kein Markdown, keine Erklärung, kein Codeblock. Beginne direkt mit <!DOCTYPE html>. Deine Ausgabe MUSS mit </body></html> enden.`;
}

// ─── Generation with streaming ────────────────────────────────────────────

async function generatePresentation({ prompt, conversation = [], templateSystemPrompt, brand, attachments = [], model = 'claude-sonnet-4-6' }, onChunk) {
  const anthropic = getClient();
  const sysPrompt = buildSystemPrompt(templateSystemPrompt || DEFAULT_SYSTEM_PROMPT, brand);

  // Build content for the new user message
  let userContent;
  if (attachments.length > 0) {
    const blocks = [];

    // Image attachments → vision blocks
    for (const att of attachments.filter(a => a.type === 'image')) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: att.mediaType, data: att.data },
      });
    }

    // Text attachments → prepend as context
    const textAtts = attachments.filter(a => a.type === 'text');
    let contextPrefix = '';
    if (textAtts.length > 0) {
      contextPrefix = '## Hochgeladene Dokumente als Quelldaten:\n\n' +
        textAtts.map(a => `### ${a.name}\n${a.content}`).join('\n\n---\n\n') +
        '\n\n---\n\n## Aufgabe:\n';
    }

    blocks.push({ type: 'text', text: contextPrefix + prompt });
    userContent = blocks;
  } else {
    userContent = prompt;
  }

  const messages = [
    ...conversation.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent }
  ];

  let fullContent = '';
  let stopReason = null;

  // Model-specific token limits
  const maxTokens = model.includes('haiku') ? 8000 : 32000;

  const stream = await anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system: sysPrompt,
    messages
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullContent += chunk.delta.text;
      if (onChunk) onChunk(chunk.delta.text);
    }
    if (chunk.type === 'message_delta' && chunk.delta.stop_reason) {
      stopReason = chunk.delta.stop_reason;
    }
  }

  // Inject the navigation framework (includes HTML repair)
  const finalHtml = injectFramework(fullContent);
  return { html: finalHtml, stopReason };
}

function stripFramework(html) {
  // Remove new-style marked framework
  if (html.includes(FRAMEWORK_START)) {
    const start = html.indexOf(FRAMEWORK_START);
    const end   = html.indexOf(FRAMEWORK_END);
    if (end !== -1) {
      return html.slice(0, start) + html.slice(end + FRAMEWORK_END.length);
    }
    return html.slice(0, start);
  }

  // Remove old-style unmarked framework (identified by the unique style tag id)
  const styleTag = '<style id="nexus-engine-styles">';
  if (html.includes(styleTag)) {
    // The framework is always the last block before </body>; strip from style tag to </body>
    const start = html.indexOf(styleTag);
    // Walk back to catch the preceding comment line if present
    const lineStart = html.lastIndexOf('\n', start);
    const cutFrom = lineStart !== -1 ? lineStart : start;
    const bodyClose = html.lastIndexOf('</body>');
    if (bodyClose !== -1 && bodyClose > start) {
      return html.slice(0, cutFrom) + '\n</body>' + html.slice(bodyClose + 7);
    }
    return html.slice(0, cutFrom);
  }

  return html;
}

// ─── HTML repair: close truncated output ─────────────────────────────────

function repairHtml(html) {
  if (/<\/html>/i.test(html)) return html; // already complete

  // Balance open/closed divs in the body section to close truncated slides
  const bodyIdx = html.search(/<body/i);
  const bodyPart = bodyIdx >= 0 ? html.slice(bodyIdx) : html;
  const opens  = (bodyPart.match(/<div[\s>]/gi) || []).length;
  const closes = (bodyPart.match(/<\/div>/gi) || []).length;
  const diff   = Math.max(0, opens - closes);

  let closing = '';
  for (let i = 0; i < diff; i++) closing += '\n</div>';
  if (!/<\/body>/i.test(html)) closing += '\n</body>';
  closing += '\n</html>';

  return html + closing;
}

function injectFramework(rawHtml) {
  let html = rawHtml.trim();

  // Strip markdown code fences Claude sometimes adds despite instructions
  if (html.startsWith('```')) {
    html = html.replace(/^```(?:html)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }

  // Remove any placeholder text and any existing framework version
  html = html.replace(/\[NEXUS_FRAMEWORK\]/g, '');
  html = stripFramework(html);

  // Repair truncated HTML before injecting the framework
  html = repairHtml(html);

  // Inject framework before </body>
  html = html.replace(/<\/body>/i, '\n' + PRESENTATION_FRAMEWORK + '\n</body>');

  // Guarantee closing tags after injection
  if (!/<\/html>/i.test(html)) html += '\n</html>';

  return html;
}

module.exports.stripFramework = stripFramework;

// ─── Narrative Arc Analysis ────────────────────────────────────────────────

async function analyzeNarrativeArc(htmlContent) {
  const anthropic = getClient();

  // Extract slide content (strip HTML tags for analysis)
  const textContent = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 3000);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Analysiere diese Präsentation und gib strukturiertes Feedback auf Deutsch.

Präsentationsinhalt:
${textContent}

Antworte als JSON:
{
  "score": 1-10,
  "strengths": ["Stärke 1", "Stärke 2"],
  "improvements": ["Verbesserung 1", "Verbesserung 2"],
  "narrativeFlow": "gut|okay|schwach",
  "summary": "Kurze Zusammenfassung"
}`
    }]
  });

  try {
    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { score: 7, strengths: [], improvements: [], narrativeFlow: 'okay', summary: 'Analyse nicht verfügbar' };
  }
}

// ─── Suggest improvements ────────────────────────────────────────────────

async function suggestImprovements(htmlContent, focusArea) {
  const anthropic = getClient();
  const textContent = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 2000);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Du bist ein Präsentationsberater. Gib 3 konkrete, umsetzbare Verbesserungsvorschläge auf Deutsch für diese Präsentation.
${focusArea ? `Fokus: ${focusArea}` : ''}

Inhalt: ${textContent}

Format: JSON Array mit {title, description, prompt} wobei prompt ein fertig formulierter Prompt für Claude ist.`
    }]
  });

  try {
    const text = response.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]+\]/);
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

const DEFAULT_SYSTEM_PROMPT = `Erstelle visuell beeindruckende Präsentationen mit modernem Design, Glasmorphismus, Gradienten und CSS-Animationen. Sei kreativ und innovativ.`;

// ─── Analyze PPTX and generate template ──────────────────────────────────

async function analyzeTemplateFromPptx({ textContent, themeColors, slideCount }) {
  const anthropic = getClient();

  const colorLines = Object.entries(themeColors)
    .filter(([k]) => !['majorFont', 'minorFont'].includes(k))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const fontLines = [themeColors.majorFont, themeColors.minorFont]
    .filter(Boolean).join(', ');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Du analysierst eine PowerPoint-Präsentation (${slideCount} Folien) und erstellst daraus ein Template für Slides.IQ.

PRÄSENTATIONSINHALT:
${textContent.substring(0, 3000)}

EXTRAHIERTE DESIGNDATEN:
Farben:
${colorLines || '  (keine Farbdaten verfügbar)'}
${fontLines ? `Schriftarten: ${fontLines}` : ''}

Erstelle ein Slides.IQ Template das den erkannten visuellen Stil widerspiegelt.

Antworte ausschließlich als JSON (kein Markdown):
{
  "name": "Template-Name (kreativ, prägnant, max 30 Zeichen)",
  "description": "Kurze Stilbeschreibung (max 100 Zeichen)",
  "primaryColor": "#hexcode",
  "accentColor": "#hexcode",
  "bgColor": "#hexcode",
  "style": "cosmic|minimal|neon|corporate|gradient",
  "system_prompt": "Detaillierter System-Prompt für Claude der den erkannten visuellen Stil beschreibt: Farbpalette, Typografie, Layout-Präferenzen, Animationsstil, visuelle Atmosphäre. Verwende die extrahierten Farben. 200-300 Wörter auf Deutsch."
}`
    }]
  });

  try {
    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    const r = JSON.parse(jsonMatch[0]);
    return {
      name:          r.name          || 'Importiertes Template',
      description:   r.description   || 'Aus PowerPoint importiert',
      system_prompt: r.system_prompt || 'Erstelle Präsentationen im professionellen Stil.',
      theme: {
        primaryColor: r.primaryColor || '#7c3aed',
        accentColor:  r.accentColor  || '#06b6d4',
        bgColor:      r.bgColor      || '#05070f',
        style:        r.style        || 'corporate'
      }
    };
  } catch {
    return {
      name: 'Importiertes Template',
      description: 'Aus PowerPoint importiert',
      system_prompt: 'Erstelle Präsentationen im modernen professionellen Stil.',
      theme: { primaryColor: '#7c3aed', accentColor: '#06b6d4', bgColor: '#05070f', style: 'corporate' }
    };
  }
}

// ─── Generate / edit a single slide ──────────────────────────────────────

async function generateSingleSlide({ prompt, slideHtml = '', cssContext = '', surroundingSlides = [], model = 'claude-sonnet-4-6', mode = 'edit' }, onChunk) {
  const anthropic = getClient();

  const cssSection = cssContext
    ? `\n\nVorhandenes CSS der Präsentation (Stil beibehalten):\n<css>\n${cssContext}\n</css>`
    : '';

  const surroundingContext = surroundingSlides.length > 0
    ? `\n\nNachbarn-Slides (nur als Stil-Referenz — diese NICHT ausgeben):\n${surroundingSlides.join('\n\n')}`
    : '';

  const systemPrompt = `Du bist Slides.IQ — Experte für einzelne HTML-Präsentations-Slides.
Deine Aufgabe: Gib NUR ein einziges <div class="slide"> Element zurück.

REGELN:
- Beginne DIREKT mit <div class="slide"
- Ende mit </div> — KEIN </body>, KEIN </html>, KEIN Markdown
- KEINE neuen <style> Tags — nutze inline-Styles die zu den vorhandenen CSS Custom Properties passen
- Nutze: --primary, --accent, --bg, --text
- Setze data-notes mit Speaker Notes
- Visuell hochwertig: klare Hierarchie, prägnanter Text, ansprechendes Layout${cssSection}${surroundingContext}`;

  const userMessage = mode === 'edit'
    ? `Bestehende Slide:\n${slideHtml}\n\nAufgabe: ${prompt}\n\nGib die überarbeitete Slide zurück.`
    : `Erstelle eine neue Slide: ${prompt}\n\nGib die neue Slide zurück.`;

  let fullContent = '';
  let stopReason = null;

  const stream = await anthropic.messages.stream({
    model,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullContent += chunk.delta.text;
      if (onChunk) onChunk(chunk.delta.text);
    }
    if (chunk.type === 'message_delta' && chunk.delta.stop_reason) {
      stopReason = chunk.delta.stop_reason;
    }
  }

  // Strip markdown fences if present
  const clean = fullContent.trim()
    .replace(/^```(?:html)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  return { slideHtml: clean, stopReason };
}

module.exports = {
  generatePresentation,
  generateSingleSlide,
  analyzeNarrativeArc,
  suggestImprovements,
  analyzeTemplateFromPptx,
  injectFramework,
  stripFramework,
  PRESENTATION_FRAMEWORK
};
