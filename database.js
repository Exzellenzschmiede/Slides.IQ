'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/nexus.db';

// Ensure data directory exists
const dataDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS presentation_shares (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL DEFAULT 'read',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(presentation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    preview_html TEXT,
    system_prompt TEXT NOT NULL,
    theme TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS presentations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
    html_content TEXT,
    slide_count INTEGER DEFAULT 0,
    conversation TEXT NOT NULL DEFAULT '[]',
    versions TEXT NOT NULL DEFAULT '[]',
    share_token TEXT UNIQUE,
    view_count INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    brand TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS slide_library (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    html_content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    source_presentation_id TEXT REFERENCES presentations(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_presentations_updated ON presentations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_presentations_share ON presentations(share_token);
  CREATE INDEX IF NOT EXISTS idx_shares_user ON presentation_shares(user_id);
  CREATE INDEX IF NOT EXISTS idx_shares_presentation ON presentation_shares(presentation_id);
`);

// Schema migrations — add columns that may be missing in older DB instances
// SQLite has no ADD COLUMN IF NOT EXISTS, so we catch the "duplicate column" error
const migrations = [
  "ALTER TABLE presentations ADD COLUMN html_content TEXT",
  "ALTER TABLE presentations ADD COLUMN slide_count INTEGER DEFAULT 0",
  "ALTER TABLE presentations ADD COLUMN conversation TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE presentations ADD COLUMN versions TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE presentations ADD COLUMN share_token TEXT",
  "ALTER TABLE presentations ADD COLUMN view_count INTEGER DEFAULT 0",
  "ALTER TABLE presentations ADD COLUMN tags TEXT DEFAULT '[]'",
  "ALTER TABLE presentations ADD COLUMN brand TEXT DEFAULT '{}'",
  "ALTER TABLE presentations ADD COLUMN description TEXT",
  "ALTER TABLE presentations ADD COLUMN template_id TEXT",
  "ALTER TABLE presentations ADD COLUMN user_id TEXT REFERENCES users(id)",
  "ALTER TABLE settings ADD COLUMN user_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE templates ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL",
  "ALTER TABLE templates ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

// Fix settings table: the original schema had `key TEXT PRIMARY KEY` (single-column),
// which means different users sharing the same key overwrote each other's settings.
// Rebuild with composite PRIMARY KEY (key, user_id).
const settingsDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'").get();
if (settingsDef && !settingsDef.sql.includes('user_id')) {
  // user_id column not yet present — add it first so the rebuild can copy it
  try { db.exec("ALTER TABLE settings ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
}
if (settingsDef && !/PRIMARY KEY\s*\(\s*key\s*,\s*user_id\s*\)/i.test(settingsDef.sql)) {
  db.exec(`
    CREATE TABLE settings_new (
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (key, user_id)
    );
    INSERT OR IGNORE INTO settings_new (key, value, user_id)
      SELECT key, value, COALESCE(user_id, '') FROM settings;
    DROP TABLE settings;
    ALTER TABLE settings_new RENAME TO settings;
  `);
}

// Seed global default settings (user_id = '') if not yet present
const defaultSettings = {
  brand: {
    name: '', primaryColor: '#7c3aed', accentColor: '#06b6d4',
    font: 'Inter', style: 'modern', tagline: '', tone: 'professional'
  },
  preferences: {
    defaultSlideCount: 10, language: 'en', mainModel: 'claude-sonnet-4-6',
    aiProvider: 'anthropic',
    aiProviders: {
      anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
      openai:    { apiKey: '', model: 'gpt-5.5' },
      mistral:   { apiKey: '', model: 'mistral-large-3' },
      gemini:    { apiKey: '', model: 'gemini-2.5-pro' }
    }
  }
};
const seedSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value, user_id) VALUES (?, ?, '')");
for (const [key, value] of Object.entries(defaultSettings)) {
  seedSetting.run(key, JSON.stringify(value));
}

// Seed default templates
const templateCount = db.prepare('SELECT COUNT(*) as c FROM templates').get();
if (templateCount.c === 0) {
  const insert = db.prepare(`
    INSERT INTO templates (id, name, description, preview_html, system_prompt, theme)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const defaults = [
    {
      id: 'tpl-cosmic',
      name: 'Cosmic Dark',
      description: 'Tiefes Weltraum-Feeling mit violetten Nebeln und Glaszmorph-Karten',
      theme: { primaryColor: '#7c3aed', accentColor: '#06b6d4', bgColor: '#05070f', style: 'cosmic', font: 'Inter' },
      systemPrompt: `Du bist ein Elite-Präsentationsdesigner. Erstelle Präsentationen im "Cosmic Dark"-Stil:
- Dunkler Weltraum-Hintergrund (#05070f) mit subtilen Sternenfeldern (CSS)
- Violette (#7c3aed) und Cyan (#06b6d4) als Akzentfarben
- Glasmorphismus-Karten (backdrop-filter: blur, semi-transparente Backgrounds)
- Gradient-Texte mit background-clip
- Weiche Glow-Effekte und subtile Animationen
- Inter oder System-Font`
    },
    {
      id: 'tpl-minimal',
      name: 'Ultraminimal',
      description: 'Weißer Raum, Typografie als Kunst, absolute Reduktion',
      theme: { primaryColor: '#000000', accentColor: '#ef4444', bgColor: '#fafafa', style: 'minimal', font: 'Georgia' },
      systemPrompt: `Du bist ein minimalistischer Präsentationsdesigner. Erstelle Präsentationen im "Ultraminimal"-Stil:
- Weißer/heller Hintergrund, viel Weißraum
- Schwarz und ein einzelner Akzentfarbe (Rot #ef4444)
- Typografie als primäres Design-Element, große Fonts, perfekte Hierarchie
- Keine unnötigen Dekorationen, jedes Element muss eine Funktion haben
- Dramatische Kontraste durch Größe und Gewicht`
    },
    {
      id: 'tpl-neon',
      name: 'Neon Terminal',
      description: 'Cyberpunk-Ästhetik, Terminal-Grids, Neon-Glows für Tech-Themen',
      theme: { primaryColor: '#00ff88', accentColor: '#ff0066', bgColor: '#0a0a0a', style: 'neon', font: 'JetBrains Mono' },
      systemPrompt: `Du bist ein Cyberpunk-Präsentationsdesigner. Erstelle Präsentationen im "Neon Terminal"-Stil:
- Schwarzer Hintergrund mit Grid-Overlay (CSS grid pattern)
- Neon-Grün (#00ff88) und Neon-Pink (#ff0066) als Farben
- Monospace-Fonts, Terminal-Ästhetik
- Scanline-Effekte mit CSS
- Glitch-Animationen für Slide-Transitions
- Perfekt für Tech, Dev, Security-Themen`
    },
    {
      id: 'tpl-corporate',
      name: 'Executive Suite',
      description: 'Professionell, vertrauenswürdig, für Business und Investoren',
      theme: { primaryColor: '#1e3a5f', accentColor: '#f59e0b', bgColor: '#ffffff', style: 'corporate', font: 'Inter' },
      systemPrompt: `Du bist ein Corporate-Präsentationsdesigner. Erstelle Präsentationen im "Executive Suite"-Stil:
- Sauberes, professionelles Design mit Navy-Blau (#1e3a5f) und Gold (#f59e0b)
- Strukturierte Layouts mit klarer Informationshierarchie
- Datenvisualisierungen, Tabellen und Charts wenn passend
- Subtile Animationen, keine ablenkenden Effekte
- Vertrauen und Kompetenz als visuelle Botschaft`
    },
    {
      id: 'tpl-gradient',
      name: 'Aurora Gradient',
      description: 'Lebendige Farbverläufe, flüssige Formen, energetisch und kreativ',
      theme: { primaryColor: '#f472b6', accentColor: '#a78bfa', bgColor: '#0f0f1a', style: 'gradient', font: 'Inter' },
      systemPrompt: `Du bist ein kreativer Präsentationsdesigner. Erstelle Präsentationen im "Aurora Gradient"-Stil:
- Tiefe Dunkel-Backgrounds mit spektakulären Gradient-Overlays (Aurora-Farben: Rosa, Violett, Cyan)
- Fließende organische Formen mit border-radius und CSS transforms
- Lebendige Gradient-Texte und -Buttons
- CSS-Animationen die an Nordlichter erinnern (keyframes mit color shifts)
- Energetisch und kreativ, perfekt für Innovation und Startups`
    }
  ];

  for (const t of defaults) {
    insert.run(
      t.id,
      t.name,
      t.description,
      '<div class="preview-placeholder">Preview</div>',
      t.systemPrompt,
      JSON.stringify(t.theme)
    );
  }
}

module.exports = db;
