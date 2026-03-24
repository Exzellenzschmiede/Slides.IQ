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
    const { read, utils } = require('xlsx');
    const wb = read(buffer, { type: 'buffer' });
    return { type: 'text', name, content: workbookToText(wb, utils) };
  }

  // ── Excel ─────────────────────────────────────────────────────────────
  if (['.xlsx', '.xls', '.xlsm', '.xlsb'].includes(ext) ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel') {
    const { read, utils } = require('xlsx');
    const wb = read(buffer, { type: 'buffer' });
    return { type: 'text', name, content: workbookToText(wb, utils) };
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

// ─── Excel workbook → Markdown-style tables ───────────────────────────────

function workbookToText(wb, utils) {
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows  = utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length === 0) continue;
    parts.push(`## Tabelle: ${sheetName}`);
    for (const row of rows) {
      const line = row.map(c => String(c ?? '')).join(' | ');
      if (line.replace(/\|/g, '').trim()) parts.push(line);
    }
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

module.exports = { parseFile };
