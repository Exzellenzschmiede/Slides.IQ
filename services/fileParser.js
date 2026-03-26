'use strict';

const path = require('path');

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const TEXT_EXTS   = new Set(['.txt', '.md', '.json', '.html', '.htm']);

/**
 * Parse a file buffer and extract content for Claude.
 * Returns {type:'text'|'image', name, content?, data?, mediaType?}
 */
async function parseFile(buffer, mimeType, filename) {
  const ext  = path.extname(filename).toLowerCase();
  const name = path.basename(filename);

  // ── Images → base64 for Anthropic vision ─────────────────────────────
  if (IMAGE_MIMES.has(mimeType) || IMAGE_EXTS.has(ext)) {
    const imgMime = IMAGE_MIMES.has(mimeType)
      ? mimeType
      : `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;
    return { type: 'image', name, data: buffer.toString('base64'), mediaType: imgMime };
  }

  // ── Plain text / Markdown / JSON / HTML ──────────────────────────────
  if (TEXT_EXTS.has(ext) || mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return { type: 'text', name, content: buffer.toString('utf8') };
  }

  // ── CSV ───────────────────────────────────────────────────────────────
  if (ext === '.csv' || mimeType === 'text/csv') {
    return { type: 'text', name, content: parseCsv(buffer.toString('utf8')) };
  }

  // ── Excel ─────────────────────────────────────────────────────────────
  if (['.xlsx', '.xlsm'].includes(ext) ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return { type: 'text', name, content: excelToText(wb) };
  }
  if (['.xls', '.xlsb'].includes(ext) || mimeType === 'application/vnd.ms-excel') {
    throw new Error('Das Format .xls/.xlsb wird nicht mehr unterstützt. Bitte als .xlsx speichern.');
  }

  // ── Word DOCX ─────────────────────────────────────────────────────────
  if (ext === '.docx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    return { type: 'text', name, content: result.value };
  }

  // ── PDF ───────────────────────────────────────────────────────────────
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const data     = await pdfParse(buffer);
    return { type: 'text', name, content: data.text };
  }

  // ── PowerPoint PPTX ───────────────────────────────────────────────────
  if (ext === '.pptx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    const content = parsePptx(buffer);
    return { type: 'text', name, content };
  }

  // ── Fallback: try UTF-8 ───────────────────────────────────────────────
  const text = buffer.toString('utf8');
  if (!/[\x00-\x08\x0E-\x1F]/.test(text.substring(0, 500))) {
    return { type: 'text', name, content: text };
  }

  throw new Error(`Nicht unterstützter Dateityp: ${ext || mimeType}`);
}

// ─── ExcelJS workbook → Markdown-style tables ────────────────────────────

function excelToText(wb) {
  const parts = [];
  wb.eachSheet(sheet => {
    parts.push(`## Tabelle: ${sheet.name}`);
    sheet.eachRow(row => {
      const line = row.values.slice(1).map(c => String(c ?? '')).join(' | ');
      if (line.replace(/\|/g, '').trim()) parts.push(line);
    });
  });
  return parts.join('\n');
}

// ─── Native CSV parser (handles quoted fields) ────────────────────────────

function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const parts = [];
  for (const line of lines) {
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; }
      else if (line[i] === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += line[i]; }
    }
    cells.push(cur.trim());
    const row = cells.join(' | ');
    if (row.replace(/\|/g, '').trim()) parts.push(row);
  }
  return parts.join('\n');
}

// ─── PPTX: extract text from ZIP/XML ─────────────────────────────────────

function parsePptx(buffer) {
  const AdmZip = require('adm-zip');
  const zip    = new AdmZip(buffer);

  const slideEntries = zip.getEntries()
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const n = e => parseInt(e.entryName.match(/(\d+)/)[1], 10);
      return n(a) - n(b);
    });

  return slideEntries.map((entry, i) => {
    const xml   = entry.getData().toString('utf8');
    const texts = [];
    const re    = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].trim();
      if (t) texts.push(t);
    }
    return texts.length ? `Folie ${i + 1}: ${texts.join(' ')}` : null;
  }).filter(Boolean).join('\n\n');
}

// ─── PPTX: extract design info for template generation ───────────────────

function parsePptxForTemplate(buffer) {
  const AdmZip = require('adm-zip');
  const zip    = new AdmZip(buffer);

  const textContent = parsePptx(buffer);

  // Extract theme colors from ppt/theme/theme1.xml
  const themeColors = {};
  const themeEntry  = zip.getEntry('ppt/theme/theme1.xml');
  if (themeEntry) {
    const xml = themeEntry.getData().toString('utf8');

    // Named color slots
    const slots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3'];
    for (const slot of slots) {
      const srgb = xml.match(new RegExp(`<a:${slot}[^>]*>[\\s\\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"`, 'm'));
      const sys  = xml.match(new RegExp(`<a:${slot}[^>]*>[\\s\\S]*?<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"`, 'm'));
      if (srgb) themeColors[slot] = '#' + srgb[1];
      else if (sys) themeColors[slot] = '#' + sys[1];
    }

    // Font scheme
    const majorFont = xml.match(/<a:majorFont[^>]*>[\s\S]*?<a:latin typeface="([^"+][^"]*)"/m);
    const minorFont = xml.match(/<a:minorFont[^>]*>[\s\S]*?<a:latin typeface="([^"+][^"]*)"/m);
    if (majorFont) themeColors.majorFont = majorFont[1];
    if (minorFont) themeColors.minorFont = minorFont[1];
  }

  const slideCount = (textContent.match(/^Folie \d+:/mg) || []).length;

  return { textContent, themeColors, slideCount };
}

module.exports = { parseFile, parsePptxForTemplate };
