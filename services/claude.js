'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const aiProvider = require('./aiProvider');

// Anthropic client for Haiku-based helper functions (always Anthropic-only)
let _anthropicClient = null;

function getAnthropicClient(apiKey) {
  if (!apiKey) throw new Error('Kein Anthropic API-Key konfiguriert. Bitte hinterlege deinen API-Key in den Einstellungen.');
  return new Anthropic({ apiKey });
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
}
body { font-family: var(--font, 'Inter', system-ui, sans-serif); background: var(--bg, #05070f); color: var(--text, #e2e8f0); position: relative; }

#nexus-presentation {
  position: absolute;
  top: 0; left: 0;
  width: 1280px; height: 720px;
  overflow: hidden;
  transform-origin: top left;
}

/* High-specificity rules so Claude's generated CSS cannot override show/hide */
#nexus-presentation .slide {
  position: absolute !important; inset: 0 !important;
  display: flex !important; align-items: flex-start !important; justify-content: flex-start !important;
  opacity: 0 !important; pointer-events: none !important;
  transform: translateX(60px) scale(0.97) !important;
  transition: opacity 0.5s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1);
  padding: 4rem !important;
  overflow-y: auto !important; overflow-x: hidden !important;
  box-sizing: border-box !important;
  width: 1280px !important; height: 720px !important;
  min-width: 0 !important; min-height: 0 !important;
}
/* Harden direct children: prevent overflow, honour box model */
#nexus-presentation .slide > * {
  max-width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
}
/* Media & table elements must never blow out the canvas width */
#nexus-presentation .slide img,
#nexus-presentation .slide video,
#nexus-presentation .slide canvas,
#nexus-presentation .slide table,
#nexus-presentation .slide pre,
#nexus-presentation .slide svg {
  max-width: 100% !important;
  height: auto;
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
/* Live audience follower: pure projection, no controls */
body.nexus-live-follower #nexus-controls,
body.nexus-live-follower #speaker-notes-panel,
body.nexus-live-follower #overview-panel { display: none !important; }
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
  var liveFollower = false; // true on /view/:token?live=1 — slide nav driven by presenter

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
    if (liveFollower) { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); return; }
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
    if (liveFollower) return;
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

  // Viewport scaling — render at 1280×720, scale to fit available area
  function scalePresentation() {
    var pres = document.getElementById('nexus-presentation');
    if (!pres) return;
    var availW = window.innerWidth;
    var availH = window.innerHeight;
    // Reserve space for controls only when they are "always-visible" (presenter mode)
    var controls = document.getElementById('nexus-controls');
    if (controls && controls.classList.contains('always-visible')) {
      availH -= controls.offsetHeight;
    }
    var scale = Math.min(availW / 1280, availH / 720);
    var offsetX = (availW - 1280 * scale) / 2;
    var offsetY = (availH - 720 * scale) / 2;
    pres.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
  }
  // Initial scaling + retries to catch deferred iframe/flexbox layouts
  scalePresentation();
  setTimeout(scalePresentation, 50);
  setTimeout(scalePresentation, 200);
  setTimeout(scalePresentation, 600);
  window.addEventListener('resize', scalePresentation);
  window.addEventListener('load', scalePresentation);
  document.addEventListener('fullscreenchange', function () {
    setTimeout(scalePresentation, 50);
    setTimeout(scalePresentation, 250);
    setTimeout(scalePresentation, 600);
  });
  // ResizeObserver ensures correct scaling when the iframe container is resized
  // (e.g. Studio split-pane, sidebar toggling)
  try {
    new ResizeObserver(function() { scalePresentation(); }).observe(document.documentElement);
  } catch(e) {}

  // ─── Live audience sync (follower) ──────────────────────────────────────
  // Active only on the public page /view/:token when opened with ?live=1.
  // Connects to the WS room and follows the presenter's slide changes.
  (function initLiveFollow() {
    var parts = location.pathname.split('/').filter(Boolean); // e.g. ['view','TOKEN']
    var params = new URLSearchParams(location.search);
    if (parts[0] !== 'view' || !parts[1] || !params.has('live')) return;
    var token = parts[1];
    liveFollower = true;
    document.body.classList.add('nexus-live-follower');
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    var wsUrl = proto + '://' + location.host + '/ws?token=' + encodeURIComponent(token);
    var ws, reconnectTimer;
    function scheduleReconnect() {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
    function connect() {
      try { ws = new WebSocket(wsUrl); }
      catch (e) { scheduleReconnect(); return; }
      ws.addEventListener('message', function(ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg && msg.type === 'slide-change' && typeof msg.index === 'number'
              && msg.index >= 0 && msg.index < slides.length && msg.index !== current) {
            goto(msg.index, true);
          }
        } catch (e) {}
      });
      ws.addEventListener('close', scheduleReconnect);
      ws.addEventListener('error', function() { try { ws.close(); } catch (e) {} });
    }
    connect();
  })();

  // Init
  goto(0);
})();
</script>
${FRAMEWORK_END}
`;

// ─── System prompt builder ────────────────────────────────────────────────

function buildSystemPrompt(templateSystemPrompt, templateTheme) {
  const t = templateTheme && Object.keys(templateTheme).length > 0 ? templateTheme : null;
  const designLines = t ? [
    t.primaryColor && `- Primärfarbe: ${t.primaryColor}`,
    t.accentColor  && `- Akzentfarbe: ${t.accentColor}`,
    t.bgColor      && `- Hintergrundfarbe: ${t.bgColor}`,
    t.font         && `- Schriftart: ${t.font}`,
    t.style        && `- Design-Stil: ${t.style}`,
    t.tone         && `- Ton/Stimme: ${t.tone}`,
  ].filter(Boolean) : [];
  const designSection = designLines.length > 0 ? `
## Design-Parameter (MÜSSEN eingehalten werden)
${designLines.join('\n')}
Setze diese Parameter konsequent in allen Slides um.
` : '';

  return `Du bist Slides.IQ — ein weltklasse AI-Präsentationsarchitekt. Du erstellst atemberaubende, vollständig eigenständige HTML-Präsentationen die Kunst und Technologie verbinden.

${templateSystemPrompt}

${designSection}

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
    /* Dein komplettes CSS hier */
    /* ✅ ERLAUBT: Custom Properties, Backgrounds auf .slide, Animationen, Grid, Flexbox */
    /* 🚫 VERBOTEN: position/opacity/transform auf .slide, overflow:hidden, vw/vh-Einheiten, position:fixed */
    :root { --primary: #7c3aed; --accent: #06b6d4; --bg: #05070f; --text: #f0f0ff; --font: 'Inter', sans-serif; }
    body { margin: 0; background: var(--bg); }
    /* Background IMMER direkt auf .slide — nie nur auf einem Kind-Element */
    .slide { background: var(--bg); }
    /* Inhalts-Container: kein overflow:hidden, kein height:100% */
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
- **Schriftgrößen ausschließlich in px** — kein vw, vh, em, clamp() mit Viewport-Einheiten

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

## 🚫 CSS-VERBOTE — NIEMALS VERWENDEN (führen zu Rendering-Fehlern)

1. **overflow: hidden** auf .slide oder einem Kinder-Element — die Engine steuert Overflow
2. **position: fixed** — bricht im skalierten 1280x720-Canvas vollständig
3. **Viewport-Einheiten** (vw, vh, dvh, svh, cqw, cqh) — der Canvas ist immer 1280x720 px; nutze ausschließlich px-Werte oder % relativ zum 1280x720-Koordinatensystem
4. **clamp() mit Viewport-Einheiten** — gleiche Begründung
5. **height: 100vh, min-height: 100vh, height: 100%** auf Elementen innerhalb von .slide — die Slide-Höhe ist fest 720 px
6. **width oder height direkt auf .slide setzen** — wird vom Engine überschrieben
7. **background-attachment: fixed** — funktioniert nicht im iframe / scaled Canvas

## 🎨 HINTERGRUND-PFLICHT

Der Folienhintergrund MUSS direkt auf dem .slide-Element definiert werden — NICHT auf einem Kind-Element:

  RICHTIG:  .slide { background: linear-gradient(135deg, #0d0d1a, #1a0533); }
  FALSCH:   .slide .bg-wrapper { background: ...; }  /* führt zu Hintergrundlücken */

Wenn du dekorative Elemente oder Overlay-Schichten benötigst, nutze position: absolute; inset: 0 auf dem Kind-Element und setze trotzdem den Basis-Hintergrund auf .slide.

## 📐 SCHRIFTGRÖSSEN UND MAßE

Ausschließlich px-Werte — der Canvas ist immer exakt 1280x720 px:
- Hauptüberschriften: 48–80 px
- Zwischenüberschriften: 28–42 px
- Fließtext: 16–22 px
- Captions/Labels: 12–15 px

## ⚠️ KEINE RÜCKFRAGEN — ABSOLUT KRITISCH

Stelle NIEMALS Rückfragen. Erzeuge IMMER die vollständige Präsentation, auch wenn der Prompt kurz oder vage ist. Triff sinnvolle kreative Annahmen. Eine Präsentation mit Platzhalter-Inhalten ist besser als eine Folie mit einer Frage. Der Nutzer kann nach der Generierung weitere Anweisungen geben.

## AUSGABE
Gib NUR den vollständigen HTML-Code zurück. Kein Markdown, keine Erklärung, kein Codeblock. Beginne direkt mit <!DOCTYPE html>. Deine Ausgabe MUSS mit </body></html> enden.`;
}

// ─── Generation with streaming ────────────────────────────────────────────

// Render a confirmed outline into an authoritative spec for the generator.
// Handles both the rich shape ({title,type,points}) and legacy string titles.
function renderOutlineSpec(outline) {
  const lines = outline.map((item, i) => {
    if (typeof item === 'string') return `${i + 1}. ${item}`;
    const type = item.type ? ` [${item.type}]` : '';
    const head = `${i + 1}.${type} ${item.title || ''}`.trim();
    const pts = Array.isArray(item.points) && item.points.length
      ? '\n' + item.points.map(p => `   - ${p}`).join('\n')
      : '';
    return head + pts;
  }).join('\n');
  return `Umzusetzende Gliederung — der Nutzer hat sie bestätigt. Halte EXAKT diese Reihenfolge, Folientitel und Inhalte ein (eine Folie pro Punkt, die Stichpunkte als Inhalt der Folie ausarbeiten):\n${lines}`;
}

async function generatePresentation({ prompt, plan = null, conversation = [], templateSystemPrompt, templateTheme, attachments = [], model = 'claude-sonnet-4-6', provider = 'anthropic', apiKey }, onChunk) {
  const sysPrompt = buildSystemPrompt(templateSystemPrompt || DEFAULT_SYSTEM_PROMPT, templateTheme);

  // If a confirmed plan outline exists, prepend it to guide generation.
  // The user reviewed/edited this outline — treat it as the authoritative spec.
  const effectivePrompt = plan?.outline?.length
    ? `${prompt}\n\n${renderOutlineSpec(plan.outline)}`
    : prompt;

  // Build content for the new user message.
  // For Anthropic we support vision blocks; for other providers we fall back to text.
  let userContent;
  if (attachments.length > 0) {
    const isAnthropic = provider === 'anthropic';
    const blocks = [];

    if (isAnthropic) {
      // Image attachments → vision blocks (Anthropic only)
      for (const att of attachments.filter(a => a.type === 'image')) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mediaType, data: att.data },
        });
      }
    } else {
      // Non-Anthropic: image attachments become placeholder text
      const imageAtts = attachments.filter(a => a.type === 'image');
      if (imageAtts.length > 0) {
        blocks.push({ type: 'text', text: imageAtts.map(a => `[Bild-Anhang: ${a.name || 'Bild'}]`).join('\n') });
      }
    }

    // Text attachments → prepend as context
    const textAtts = attachments.filter(a => a.type === 'text');
    let contextPrefix = '';
    if (textAtts.length > 0) {
      contextPrefix = '## Hochgeladene Dokumente als Quelldaten:\n\n' +
        textAtts.map(a => `### ${a.name}\n${a.content}`).join('\n\n---\n\n') +
        '\n\n---\n\n## Aufgabe:\n';
    }

    blocks.push({ type: 'text', text: contextPrefix + effectivePrompt });
    userContent = blocks;
  } else {
    userContent = effectivePrompt;
  }

  // Assistant turns are stored as the fully-rendered deck (framework engine
  // CSS+JS injected). The model must never see that engine — it only authors
  // slides, and the framework is re-injected afterwards. Strip it from prior
  // turns to cut token bloat and avoid the model echoing engine code.
  const messages = [
    ...conversation.map(m => ({
      role: m.role,
      content: (m.role === 'assistant' && looksLikeHtml(m.content)) ? stripFramework(m.content) : m.content
    })),
    { role: 'user', content: userContent }
  ];

  const { text: fullContent, stopReason } = await aiProvider.streamGenerate({
    provider,
    apiKey,
    model,
    messages,
    systemPrompt: sysPrompt,
    onChunk,
  });

  // Inject the navigation framework (includes HTML repair)
  const finalHtml = injectFramework(fullContent);
  return { html: finalHtml, stopReason };
}

function stripFramework(html) {
  // Also strip the injected hardening <style> block so the AI never sees it
  html = html.replace(/<style id="nexus-hardening">[\s\S]*?<\/style>/i, '');

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

  // Inject hardening CSS right after the AI's last </style> block (before </head> or early in <body>)
  // This runs after the AI's CSS so it wins the cascade without needing !important everywhere.
  const HARDENING_CSS = `<style id="nexus-hardening">
/* ── Slides.IQ hardening: wins over AI-generated CSS ── */
#nexus-presentation { overflow: hidden !important; }
#nexus-presentation .slide {
  overflow-x: hidden !important; overflow-y: auto !important;
  padding: 4rem !important; box-sizing: border-box !important;
}
/* Prevent any descendant from blowing out the 1280-px canvas width */
#nexus-presentation .slide * { max-width: 100%; box-sizing: border-box; }
/* Replaced content: never scale beyond the slide */
#nexus-presentation .slide img,
#nexus-presentation .slide video,
#nexus-presentation .slide canvas,
#nexus-presentation .slide svg   { max-width: 100% !important; height: auto; }
/* Tables & preformatted blocks scroll rather than overflow */
#nexus-presentation .slide table,
#nexus-presentation .slide pre   { display: block; overflow-x: auto; max-width: 100%; }
/* No fixed positioning inside the scaled canvas */
#nexus-presentation .slide * { --unused: none; }
</style>`;

  // Insert hardening after the last </style> in <head>, or just before </head>
  const headEnd = html.search(/<\/head>/i);
  if (headEnd !== -1) {
    html = html.slice(0, headEnd) + HARDENING_CSS + '\n' + html.slice(headEnd);
  } else {
    // Fallback: insert after the last </style>
    const lastStyle = html.lastIndexOf('</style>');
    if (lastStyle !== -1) {
      html = html.slice(0, lastStyle + 8) + '\n' + HARDENING_CSS + html.slice(lastStyle + 8);
    }
  }

  // Inject framework before </body>
  html = html.replace(/<\/body>/i, '\n' + PRESENTATION_FRAMEWORK + '\n</body>');

  // Guarantee closing tags after injection
  if (!/<\/html>/i.test(html)) html += '\n</html>';

  return html;
}

module.exports.stripFramework = stripFramework;

// True when a stored conversation turn carries a full HTML deck (assistant
// turns store the rendered presentation as their content).
function looksLikeHtml(s) {
  return typeof s === 'string' && /<(?:!doctype|html|div|section|style|body)\b/i.test(s);
}

// ─── Slide text extraction for AI analysis ─────────────────────────────────
// IMPORTANT: a naive `replace(/<[^>]+>/g, ' ')` only removes the tags, not the
// text *inside* <style>/<script> blocks — so the head CSS and the framework JS
// survive and dominate the output. With a char cap, the first N chars end up
// being raw CSS and the actual slide text is cut off entirely. We must drop
// style/script/comment blocks (content included) before stripping tags.
function extractPresentationText(htmlContent, limit = 6000) {
  let html = stripFramework(htmlContent || '');

  // Pull speaker notes first (they carry narrative intent) before attrs vanish
  const notes = [];
  html.replace(/data-notes=("|')([\s\S]*?)\1/gi, (_, _q, n) => {
    const v = n.trim();
    if (v) notes.push(v);
    return '';
  });

  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')   // drop CSS blocks (content included)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ') // drop JS blocks (content included)
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')     // drop <head> (meta/title/links)
    .replace(/<!--[\s\S]*?-->/g, ' ')            // drop comments (framework markers)
    .replace(/<[^>]+>/g, ' ')                    // strip remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')                  // collapse leftover entities
    .replace(/\s+/g, ' ')
    .trim();

  if (notes.length) {
    text += '\n\n[Speaker Notes]\n' + notes.join('\n');
  }
  return text.substring(0, limit);
}

// ─── Narrative Arc Analysis ────────────────────────────────────────────────

async function analyzeNarrativeArc(htmlContent, apiKey) {
  const anthropic = getAnthropicClient(apiKey);

  // Extract human-readable slide content (CSS/JS removed — see helper above)
  const textContent = extractPresentationText(htmlContent, 6000);

  // Empty/near-empty deck: report clearly instead of letting the model guess
  if (textContent.trim().length < 40) {
    return {
      score: 0,
      strengths: [],
      improvements: ['Die Präsentation enthält noch keinen auswertbaren Textinhalt. Erstelle zuerst Folien mit Inhalt.'],
      narrativeFlow: 'schwach',
      summary: 'Noch kein auswertbarer Inhalt vorhanden.'
    };
  }

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

async function suggestImprovements(htmlContent, focusArea, apiKey) {
  const anthropic = getAnthropicClient(apiKey);
  const textContent = extractPresentationText(htmlContent, 4000);

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

async function analyzeTemplateFromPptx({ textContent, themeColors, slideCount }, apiKey) {
  const anthropic = getAnthropicClient(apiKey);

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

// ─── Plan a presentation (non-streaming, returns structured JSON) ─────────

async function planPresentation({ prompt, attachments = [], existingSlideCount = 0, conversation = [], previousPlan = null, model, provider = 'anthropic', apiKey }) {
  // Build context from text attachments
  let attachmentContext = '';
  const textAtts = attachments.filter(a => a.type === 'text');
  if (textAtts.length > 0) {
    attachmentContext = '\n\nAttached documents:\n' +
      textAtts.map(a => `### ${a.name}\n${(a.content || '').substring(0, 1500)}`).join('\n\n---\n\n');
  }
  if (attachments.filter(a => a.type === 'image').length > 0) {
    attachmentContext += `\n\n[${attachments.filter(a => a.type === 'image').length} image attachment(s)]`;
  }

  // Include the last 8 conversation turns for full context
  const recentConversation = conversation.slice(-8);
  const conversationContext = recentConversation.length > 0
    ? '\n\nConversation so far:\n' + recentConversation.map(m => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        let raw = Array.isArray(m.content)
          ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
          : String(m.content || '');
        // Assistant turns store the full HTML deck — distill to readable slide
        // text so the planner sees actual slide content, not raw CSS/markup.
        if (looksLikeHtml(raw)) raw = extractPresentationText(raw, 500);
        return `${role}: ${raw.substring(0, 500)}`;
      }).join('\n')
    : '';

  const stateNote = existingSlideCount > 0
    ? `The presentation currently has ${existingSlideCount} slides.`
    : 'The presentation is empty (no slides yet).';

  // Revision mode: the user is refining an already-proposed outline.
  const revisionSection = previousPlan && Array.isArray(previousPlan.outline) && previousPlan.outline.length
    ? `\n\nThis is a REVISION. Here is the outline you previously proposed (as JSON):
${JSON.stringify({ action: previousPlan.action, outline: previousPlan.outline }, null, 0)}
Apply the user's adjustment below to THIS outline and return the COMPLETE updated outline (keep unchanged slides as-is, keep the same action unless the user clearly asks otherwise).`
    : '';

  const planPrompt = `You are a sharp presentation planner. You propose the CONTENT and STRUCTURE of a deck so the user can confirm or tweak it before slides are built. ${stateNote}
${conversationContext}${revisionSection}

${previousPlan ? 'User adjustment' : 'New user request'}: ${prompt}${attachmentContext}

Respond with ONLY a JSON object (no markdown, no prose):
{
  "summary": "One short sentence in the user's language describing the deck you'll build",
  "action": "generate",
  "outline": [
    { "title": "Slide title", "type": "intro", "points": ["concrete content point", "another point"] }
  ]
}

Rules:
- "type" is a short lowercase label for the slide's role. Use one of:
  intro, agenda, content, comparison, data, process, timeline, quote, image, cta, closing.
- "points": 2-4 SHORT, CONCRETE content bullets describing what actually goes on the slide
  (real substance — numbers, names, claims — not meta like "introduce the topic").
- "title" and all "points" MUST be in the same language as the user's latest request.
- Choose exactly one "action":
  - "generate": create a complete new deck or fully replace the existing one
    (presentation is empty, or the user wants a brand-new version).
  - "insert": add NEW slides to the EXISTING presentation
    (user says add / ergänze / füge hinzu / append / weitere Folien).
- outline length = number of slides (total for "generate", new slides for "insert").
- Be realistic and tight: prefer a focused deck over padding.`;

  const text = await aiProvider.generateText({
    provider,
    apiKey,
    model,
    messages: [{ role: 'user', content: planPrompt }],
    systemPrompt: null,
    json: true, // enforce strict JSON output across all providers (incl. Mistral)
  });

  try {
    // Strip markdown code fences some models wrap JSON in, then grab the object.
    const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no JSON object in response');
    const plan = JSON.parse(jsonMatch[0]);
    // Accept the outline under a few common keys models use.
    const rawOutline = plan.outline || plan.slides || plan.outlines || [];
    if (!Array.isArray(rawOutline)) throw new Error('outline is not an array');
    plan.outline = normalizeOutline(rawOutline);
    plan.slideCount = plan.outline.length;
    plan.action = plan.action === 'insert' ? 'insert' : 'generate';
    plan.summary = plan.summary || '';
    if (!plan.outline.length) {
      console.warn(`[plan] empty outline after parse (provider=${provider}, model=${model}). raw=${String(text).slice(0, 800)}`);
    }
    return plan;
  } catch (e) {
    console.warn(`[plan] parse failed (provider=${provider}, model=${model}): ${e.message}. raw=${String(text).slice(0, 800)}`);
    return { summary: String(text || '').substring(0, 200), slideCount: 0, outline: [], action: 'generate' };
  }
}

// Normalize outline entries to the rich shape { title, type, points[] }.
// Accepts legacy string entries and tolerates partial AI output.
function normalizeOutline(outline) {
  if (!Array.isArray(outline)) return [];
  const KNOWN = ['intro','agenda','content','comparison','data','process','timeline','quote','image','cta','closing'];
  return outline.map((item) => {
    if (typeof item === 'string') return { title: item.trim(), type: 'content', points: [] };
    if (item && typeof item === 'object') {
      // Accept the various title/points keys different models emit.
      const title = String(item.title || item.heading || item.name || item.label || item.titel || item.slide || '').trim();
      let type = String(item.type || 'content').toLowerCase().trim();
      if (!KNOWN.includes(type)) type = 'content';
      const rawPoints = Array.isArray(item.points) ? item.points
        : Array.isArray(item.bullets) ? item.bullets
        : Array.isArray(item.content) ? item.content
        : (item.point ? [item.point] : []);
      const points = rawPoints.map(p => String(typeof p === 'object' ? (p.text || p.title || '') : p).trim()).filter(Boolean).slice(0, 4);
      return { title, type, points };
    }
    return { title: '', type: 'content', points: [] };
  }).filter(s => s.title);
}

// ─── Generate / edit a single slide ──────────────────────────────────────

async function generateSingleSlide({ prompt, slideHtml = '', cssContext = '', surroundingSlides = [], model = 'claude-sonnet-4-6', provider = 'anthropic', apiKey, mode = 'edit' }, onChunk) {
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

  const { text: fullContent, stopReason } = await aiProvider.streamGenerate({
    provider,
    apiKey,
    model,
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    onChunk,
  });

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
  planPresentation,
  analyzeNarrativeArc,
  suggestImprovements,
  analyzeTemplateFromPptx,
  injectFramework,
  stripFramework,
  extractPresentationText,
  normalizeOutline,
  renderOutlineSpec,
  PRESENTATION_FRAMEWORK
};
