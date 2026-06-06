'use strict';

// ─── Asset store ───────────────────────────────────────────────────────────
// Generated binary assets (PNG now; MP3/WAV later) live on disk under
// DATA_DIR/assets/<2-char-shard>/<uuid>.<ext>. The DB stores only the relative
// path. DATA_DIR tracks DB_PATH exactly like database.js, and `data/` is already
// gitignored — so assets never get committed.

const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const db = require('../database');

const DB_PATH = process.env.DB_PATH || './data/nexus.db';
const DATA_DIR = path.dirname(path.resolve(DB_PATH));
const ASSETS_DIR = path.join(DATA_DIR, 'assets');

if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

const EXT_FOR_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};

function extForMime(mime) {
  return EXT_FOR_MIME[mime] || 'bin';
}

// Persist a buffer to a sharded path. Returns { filePath (relative), bytes }.
function saveBuffer(buffer, mimeType) {
  const ext = extForMime(mimeType);
  const id = uuid();
  const shard = id.slice(0, 2);
  const shardDir = path.join(ASSETS_DIR, shard);
  if (!fs.existsSync(shardDir)) fs.mkdirSync(shardDir, { recursive: true });
  const relPath = path.posix.join(shard, `${id}.${ext}`);
  fs.writeFileSync(path.join(ASSETS_DIR, shard, `${id}.${ext}`), buffer);
  return { filePath: relPath, bytes: buffer.length };
}

// Resolve a relative asset path to an absolute one, refusing any path that
// escapes ASSETS_DIR (defense against a poisoned file_path).
function absolutePath(relPath) {
  const abs = path.resolve(ASSETS_DIR, relPath);
  if (abs !== ASSETS_DIR && !abs.startsWith(ASSETS_DIR + path.sep)) {
    throw new Error('Invalid asset path');
  }
  return abs;
}

function deleteFile(relPath) {
  try {
    fs.unlinkSync(absolutePath(relPath));
  } catch (_) { /* ENOENT or invalid path — ignore */ }
}

// Unlink every file backing a creation's assets (call before deleting the row;
// the DB cascade removes the creation_assets rows, but not the files on disk).
function deleteForCreation(creationId) {
  const rows = db.prepare('SELECT file_path FROM creation_assets WHERE creation_id = ?').all(creationId);
  for (const r of rows) deleteFile(r.file_path);
}

module.exports = {
  ASSETS_DIR,
  saveBuffer,
  absolutePath,
  deleteFile,
  deleteForCreation,
  extForMime,
};
