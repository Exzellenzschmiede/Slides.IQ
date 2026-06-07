// ─── Hub View — Creative Studio landing ────────────────────────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { toastInfo, toastError } from '../components/toast.js';
import { t, getCurrentLocale } from '../i18n.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: 'short' });
}

const MODALITIES = [
  { key: 'campaign',      icon: '◆', accent: 'var(--mod-campaigns)',     href: '#campaigns', active: true },
  { key: 'presentations', icon: '◈', accent: 'var(--mod-presentations)', href: '#dashboard', active: true },
  { key: 'images',        icon: '❖', accent: 'var(--mod-images)',        href: '#gallery',   active: true },
  { key: 'stories',       icon: '✎', accent: 'var(--mod-stories)',       href: '#stories',   active: true },
  { key: 'voice',         icon: '◌', accent: 'var(--mod-voice)',         href: '#voices',    active: true },
  { key: 'music',         icon: '♪', accent: 'var(--mod-music)',         href: '#sounds',    active: true },
];

function tileHTML(m, i) {
  const title = t(`hub.tiles.${m.key}.title`);
  const desc = t(`hub.tiles.${m.key}.desc`);
  const inner = `
    <div class="hub-tile-glow"></div>
    ${m.soon ? `<span class="hub-tile-ribbon">${t('nav.soon')}</span>` : ''}
    <div class="hub-tile-icon">${m.icon}</div>
    <div class="hub-tile-title">${title}</div>
    <div class="hub-tile-desc">${desc}</div>
    ${m.active ? `<div class="hub-tile-cta">${t('hub.open')} →</div>` : ''}
  `;
  const style = `--mod-accent:${m.accent};animation-delay:${i * 60}ms`;
  if (m.active) {
    return `<a class="hub-tile card-glow" style="${style}" href="${m.href}">${inner}</a>`;
  }
  return `<div class="hub-tile hub-tile-soon" data-soon="1" style="${style}">${inner}</div>`;
}

// ─── Intent detection — route the quick-create text to the right studio ─────
// Multilingual keyword scoring (en/de + a few it/nl/pl terms). Highest score
// wins; ties / no match fall back to image (most prompt-driven modality).
const INTENT = [
  { kind: 'campaign', words: ['campaign', 'launch', 'rebrand', 'go-to-market', 'marketing campaign', 'brand identity', 'kampagne', 'markteinführung', 'marken', 'rebranding', 'campagna', 'campagne', 'kampania', 'lancering', 'lancio'] },
  { kind: 'image', words: ['image', 'images', 'picture', 'photo', 'photograph', 'draw', 'drawing', 'illustration', 'logo', 'render', 'art', 'artwork', 'painting', 'poster', 'wallpaper', 'icon', 'visual', 'bild', 'bilder', 'foto', 'zeichne', 'zeichnung', 'gemälde', 'grafik', 'plakat', 'immagine', 'immagini', 'afbeelding', 'obraz', 'rysunek'] },
  { kind: 'music', words: ['music', 'song', 'track', 'beat', 'melody', 'tune', 'jingle', 'sound', 'sfx', 'soundtrack', 'ambient', 'musik', 'lied', 'melodie', 'klang', 'geräusch', 'soundeffekt', 'musica', 'suono', 'muziek', 'geluid', 'muzyka', 'dźwięk', 'piosenka'] },
  { kind: 'voice', words: ['voice', 'voiceover', 'voice-over', 'narrate', 'narration', 'speak', 'speech', 'tts', 'dub', 'read aloud', 'stimme', 'sprich', 'sprecher', 'vorlesen', 'erzähler', 'voce', 'narrazione', 'stem', 'inspreken', 'głos', 'lektor', 'narracja'] },
  { kind: 'story', words: ['story', 'script', 'screenplay', 'poem', 'blog', 'article', 'novel', 'tale', 'copy', 'write', 'essay', 'letter', 'geschichte', 'schreib', 'skript', 'drehbuch', 'gedicht', 'artikel', 'roman', 'erzählung', 'text', 'brief', 'storia', 'racconto', 'scrivi', 'verhaal', 'schrijf', 'historia', 'opowiadanie', 'napisz'] },
  { kind: 'presentation', words: ['presentation', 'slide', 'slides', 'deck', 'pitch', 'keynote', 'slideshow', 'präsentation', 'folie', 'folien', 'vortrag', 'presentazione', 'diapositive', 'presentatie', 'prezentacja', 'slajd'] },
];

function classifyIntent(text) {
  const s = ' ' + text.toLowerCase() + ' ';
  let best = null, bestScore = 0;
  for (const intent of INTENT) {
    let score = 0;
    for (const w of intent.words) {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (re.test(s)) score++;
    }
    if (score > bestScore) { bestScore = score; best = intent.kind; }
  }
  return best || 'image';
}

// kind → how to create the project, where to stash the seed prompt, where to go.
const CREATE = {
  campaign:     { seed: 'campaignStudioSeedPrompt', route: 'campaign-studio', make: (title) => api.creations.create('campaign', { title }) },
  image:        { seed: 'imageStudioSeedPrompt', route: 'image-studio', make: (title) => api.images.create({ title }) },
  presentation: { seed: 'studioSeedPrompt',      route: 'studio',       make: (title) => api.presentations.create({ title: title || 'Neue Präsentation' }) },
  story:        { seed: 'storyStudioSeedPrompt', route: 'story-studio', make: (title) => api.creations.create('story', { title }) },
  voice:        { seed: 'voiceStudioSeedPrompt', route: 'voice-studio', make: (title) => api.creations.create('voice', { title }) },
  music:        { seed: 'musicStudioSeedPrompt', route: 'music-studio', make: (title) => api.creations.create('music', { title }) },
};

function recentCardHTML(item) {
  const thumb = item.thumb
    ? `<img src="${item.thumb}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
    : `<div class="presentation-card-preview-placeholder">${item.icon}</div>`;
  return `
    <a class="presentation-card card-glow" href="${item.route}" style="text-decoration:none;color:inherit">
      <div class="presentation-card-preview">
        ${thumb}
        <div class="creation-type-badge">${item.badge}</div>
      </div>
      <div class="presentation-card-body">
        <div class="presentation-card-title" title="${item.title}">${item.title}</div>
        <div class="presentation-card-meta">${formatDate(item.updated_at)}</div>
      </div>
    </a>`;
}

export async function renderHub(container) {
  const name = (window.__currentUser?.name || '').split(' ')[0] || '';

  const [presentations, images, stories, voices, sounds, campaigns] = await Promise.all([
    api.presentations.list().catch(() => []),
    api.images.list().catch(() => []),
    api.creations.list('story').catch(() => []),
    api.creations.list('voice').catch(() => []),
    api.creations.list('music').catch(() => []),
    api.creations.list('campaign').catch(() => []),
  ]);

  const recent = [
    ...campaigns.map(c => ({
      id: c.id, title: c.title, updated_at: c.updated_at,
      route: `#campaign-studio/${c.id}`, icon: '◆', badge: t('hub.tiles.campaign.title'), thumb: null,
    })),
    ...presentations.map(p => ({
      id: p.id, title: p.title, updated_at: p.updated_at,
      route: `#studio/${p.id}`, icon: '◈', badge: t('hub.tiles.presentations.title'), thumb: null,
    })),
    ...images.map(c => ({
      id: c.id, title: c.title, updated_at: c.updated_at,
      route: `#image-studio/${c.id}`, icon: '❖', badge: t('hub.tiles.images.title'), thumb: c.cover_url,
    })),
    ...stories.map(c => ({
      id: c.id, title: c.title, updated_at: c.updated_at,
      route: `#story-studio/${c.id}`, icon: '✎', badge: t('hub.tiles.stories.title'), thumb: null,
    })),
    ...voices.map(c => ({
      id: c.id, title: c.title, updated_at: c.updated_at,
      route: `#voice-studio/${c.id}`, icon: '◌', badge: t('hub.tiles.voice.title'), thumb: null,
    })),
    ...sounds.map(c => ({
      id: c.id, title: c.title, updated_at: c.updated_at,
      route: `#music-studio/${c.id}`, icon: '♪', badge: t('hub.tiles.music.title'), thumb: null,
    })),
  ].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 12);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="hub-hero-title">${t('hub.title')}</h1>
        <p class="view-subtitle">${t('hub.subtitle', { name })}</p>
      </div>
    </div>

    <div class="hub-quick">
      <span class="hub-quick-icon">✦</span>
      <input type="text" id="hub-quick-input" class="form-input" placeholder="${t('hub.quickCreatePlaceholder')}" autocomplete="off">
      <span class="hub-quick-hint">${t('hub.quickHint')} <kbd>↵</kbd></span>
    </div>

    <div class="hub-modality-grid">
      ${MODALITIES.map(tileHTML).join('')}
    </div>

    <div class="hub-recent-title">${t('hub.recentTitle')}</div>
    ${recent.length
      ? `<div class="presentations-grid">${recent.map(recentCardHTML).join('')}</div>`
      : `<div class="empty-state"><div class="empty-state-icon">✦</div><div class="empty-state-desc">${t('hub.recentEmpty')}</div></div>`
    }
  `;

  // Coming-soon tiles
  container.querySelectorAll('[data-soon]').forEach(el => {
    el.addEventListener('click', () => toastInfo(t('hub.comingSoon')));
  });

  // Quick create — the text itself decides the target studio + seeds the prompt.
  const input = container.querySelector('#hub-quick-input');
  let creating = false;
  const submit = async () => {
    const prompt = input.value.trim();
    if (!prompt || creating) { input.focus(); return; }
    creating = true;
    const cfg = CREATE[classifyIntent(prompt)];
    try {
      const c = await cfg.make(prompt.slice(0, 60));
      sessionStorage.setItem(cfg.seed, prompt);
      navigate(cfg.route, { id: c.id });
    } catch (err) {
      creating = false;
      if (err.status === 402 || err.status === 403) { toastError(err.message); navigate('settings'); }
      else toastError(err.message);
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}
