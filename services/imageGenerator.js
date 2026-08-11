'use strict';

// ─── Image generation service ──────────────────────────────────────────────
// Mirrors services/aiProvider.js: dispatches across providers using the raw
// fetch pattern (no SDK). Synchronous — returns once the bytes are ready.
// Keys come from Admin settings (resolved by the route), never from env.

const DEFAULT_IMAGE_MODELS = {
  openai: 'gpt-image-1',
  gemini: 'gemini-3.1-flash-image',
};

// Aspect ratio → provider-native size string (OpenAI gpt-image-1 supports
// 1024x1024 / 1536x1024 / 1024x1536 / auto).
const SIZE_FOR_ASPECT = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
};

function sizeForAspect(aspect) {
  return SIZE_FOR_ASPECT[aspect] || '1024x1024';
}

function dimsFromSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(size || '');
  return m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10) } : { width: null, height: null };
}

async function extractErrorMessage(response) {
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || body?.detail || JSON.stringify(body);
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────
// Returns { assets: [{ buffer, mimeType, width, height, seed }], provider, model }
async function generateImage({ provider, apiKey, model, prompt, size = '1024x1024', n = 1, quality = 'high', seed }) {
  provider = provider || 'openai';
  model = model || DEFAULT_IMAGE_MODELS[provider];
  if (!apiKey) throw new Error(`Kein API-Key für ${provider} konfiguriert.`);
  if (!prompt || !prompt.trim()) throw new Error('Prompt erforderlich');

  if (provider === 'openai') return _generateOpenAI({ apiKey, model, prompt, size, n, quality });
  if (provider === 'gemini') return _generateGemini({ apiKey, model, prompt, n });
  throw new Error(`Unbekannter Bild-Provider: ${provider}`);
}

async function validateImageKey({ provider, apiKey }) {
  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return { valid: false, error: await extractErrorMessage(res) };
      return { valid: true };
    }
    if (provider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) return { valid: false, error: await extractErrorMessage(res) };
      return { valid: true };
    }
    return { valid: false, error: `Unbekannter Provider: ${provider}` };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ─── OpenAI gpt-image-1 ────────────────────────────────────────────────────

async function _generateOpenAI({ apiKey, model, prompt, size, n, quality }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, prompt, n, size, quality }),
  });

  if (!response.ok) throw new Error(await extractErrorMessage(response));

  const data = await response.json();
  const { width, height } = dimsFromSize(size);
  const assets = (data.data || [])
    .filter((d) => d.b64_json)
    .map((d) => ({
      buffer: Buffer.from(d.b64_json, 'base64'),
      mimeType: 'image/png',
      width,
      height,
      seed: null,
    }));

  if (!assets.length) throw new Error('Keine Bilder vom Provider erhalten.');
  return { assets, provider: 'openai', model };
}

// ─── Google Gemini image (Nano Banana family) ───────────────────────────────
// Gemini returns image bytes as inlineData parts. It does not take n/size the
// same way, so we loop n times for multiple variants.

async function _generateGemini({ apiKey, model, prompt, n }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const assets = [];

  for (let i = 0; i < n; i++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!response.ok) throw new Error(await extractErrorMessage(response));
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        assets.push({
          buffer: Buffer.from(part.inlineData.data, 'base64'),
          mimeType: part.inlineData.mimeType || 'image/png',
          width: null,
          height: null,
          seed: null,
        });
      }
    }
  }

  if (!assets.length) throw new Error('Keine Bilder vom Provider erhalten.');
  return { assets, provider: 'gemini', model };
}

module.exports = {
  generateImage,
  validateImageKey,
  DEFAULT_IMAGE_MODELS,
  SIZE_FOR_ASPECT,
  sizeForAspect,
};
