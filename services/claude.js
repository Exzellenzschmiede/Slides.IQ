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

const PRESENTATION_FRAMEWORK = `
/* ═══ SLIDES.IQ PRESENTATION ENGINE (embedded) ═══ */
<style id="nexus-engine-styles">
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { font-family: var(--font, 'Inter', system-ui, sans-serif); background: var(--bg, #05070f); color: var(--text, #e2e8f0); }

#nexus-presentation {
  position: fixed; inset: 0; overflow: hidden;
}
.slide {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
  transform: translateX(60px) scale(0.97);
  transition: opacity 0.5s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1);
  padding: 4rem;
}
.slide.active {
  opacity: 1; pointer-events: all;
  transform: translateX(0) scale(1);
}
.slide.prev {
  opacity: 0; pointer-events: none;
  transform: translateX(-60px) scale(0.97);
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
  const slides = Array.from(document.querySelectorAll('#nexus-presentation .slide'));
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

  // Init
  goto(0);
})();
</script>
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

## TECHNISCHE ANFORDERUNGEN

### HTML-Struktur (PFLICHT):
\`\`\`html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Präsentationstitel]</title>
  <style>/* Deine kompletten Styles hier */</style>
</head>
<body>
  <div id="nexus-presentation">
    <div class="slide active" data-notes="[Speaker Notes für Slide 1]">
      <!-- Slide 1 Inhalt -->
    </div>
    <div class="slide" data-notes="[Speaker Notes für Slide 2]">
      <!-- Slide 2 Inhalt -->
    </div>
    <!-- Weitere Slides... -->
  </div>

  [NEXUS_FRAMEWORK]
</body>
</html>
\`\`\`

Der Platzhalter [NEXUS_FRAMEWORK] wird automatisch durch das Navigation-Framework ersetzt.

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
- Mindestens 6, maximal 20 Slides
- Text: kurz, prägnant, impactvoll (kein Wall of Text)
- Typografische Hierarchie (H1 > H2 > Body)
- Visuelle "Aha-Momente" — mindestens einer pro 3 Slides

## AUSGABE
Gib NUR den vollständigen HTML-Code zurück. Kein Markdown, keine Erklärung, kein Codeblock. Beginne direkt mit <!DOCTYPE html>.`;
}

// ─── Generation with streaming ────────────────────────────────────────────

async function generatePresentation({ prompt, conversation = [], templateSystemPrompt, brand }, onChunk) {
  const anthropic = getClient();
  const sysPrompt = buildSystemPrompt(templateSystemPrompt || DEFAULT_SYSTEM_PROMPT, brand);

  const messages = [
    ...conversation.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt }
  ];

  let fullContent = '';

  const stream = await anthropic.messages.stream({
    model: 'claude-opus-4-5',
    max_tokens: 16000,
    system: sysPrompt,
    messages
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullContent += chunk.delta.text;
      if (onChunk) onChunk(chunk.delta.text);
    }
  }

  // Inject the navigation framework
  const finalHtml = injectFramework(fullContent);
  return finalHtml;
}

function injectFramework(html) {
  return html.replace('[NEXUS_FRAMEWORK]', PRESENTATION_FRAMEWORK);
}

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

module.exports = {
  generatePresentation,
  analyzeNarrativeArc,
  suggestImprovements,
  injectFramework,
  PRESENTATION_FRAMEWORK
};
