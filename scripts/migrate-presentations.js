'use strict';

/**
 * Migrations-Skript: Re-injiziert das aktuelle Slides.IQ Framework
 * in alle bestehenden Präsentationen in der Datenbank.
 *
 * Ausführen:
 *   node scripts/migrate-presentations.js
 *   node scripts/migrate-presentations.js --dry-run   (nur anzeigen, nichts schreiben)
 */

require('dotenv').config();
const db = require('../database');
const { injectFramework, stripFramework } = require('../services/claude');

const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
  console.log('🔍 DRY-RUN — keine Änderungen werden gespeichert\n');
}

const rows = db.prepare(
  'SELECT id, title, html_content FROM presentations WHERE html_content IS NOT NULL AND html_content != ""'
).all();

console.log(`📦 ${rows.length} Präsentation(en) gefunden\n`);

let updated = 0;
let skipped = 0;

for (const row of rows) {
  const html = row.html_content;

  // Detect whether the current framework is already up-to-date
  const hasNewMarker = html.includes('<!-- SLIDESIQ:FRAMEWORK:START -->');
  const hasOldStyle  = html.includes('<style id="nexus-engine-styles">');
  const hasPlaceholder = html.includes('[NEXUS_FRAMEWORK]');
  const hasNoFramework = !hasNewMarker && !hasOldStyle && !hasPlaceholder;

  let reason = '';
  if (hasNewMarker) {
    reason = 'altes SLIDESIQ-Marker-Framework → aktualisieren';
  } else if (hasOldStyle) {
    reason = 'unmarkiertes altes Framework → neu injizieren';
  } else if (hasPlaceholder) {
    reason = 'ungefüllter [NEXUS_FRAMEWORK]-Platzhalter → injizieren';
  } else {
    reason = 'kein Framework gefunden → injizieren';
  }

  console.log(`  "${row.title}" (${row.id.slice(0, 8)}…)`);
  console.log(`  → ${reason}`);

  if (!DRY_RUN) {
    const fixedHtml = injectFramework(html);

    // Recalculate slide count with fixed regex
    const slideCount = (fixedHtml.match(/class="slide(?:\s|")/g) || []).length;

    db.prepare(
      'UPDATE presentations SET html_content = ?, slide_count = ?, updated_at = datetime("now") WHERE id = ?'
    ).run(fixedHtml, slideCount, row.id);

    console.log(`  ✓ Gespeichert (${slideCount} Slides)\n`);
  } else {
    const stripped = stripFramework(html);
    const wouldHaveSlides = (stripped.match(/class="slide(?:\s|")/g) || []).length;
    console.log(`  → würde ${wouldHaveSlides} Slides erkennen\n`);
  }

  updated++;
}

console.log(`\n${ DRY_RUN ? '[DRY-RUN] ' : ''}✅ ${updated} Präsentation(en) ${DRY_RUN ? 'würden aktualisiert' : 'aktualisiert'}, ${skipped} übersprungen`);
