'use strict';

// ─── Audio generation service ──────────────────────────────────────────────
// Voice (TTS), Sound effects, and Music. ElevenLabs covers all three; OpenAI
// TTS is an alternative for voice. Raw fetch, no SDK. Returns audio buffers.
// Keys come from Admin settings (resolved by the route), never from env.

const DEFAULT_AUDIO_MODELS = {
  elevenlabs: { ttsModel: 'eleven_multilingual_v2', musicModel: 'music_v1', voiceId: '21m00Tcm4TlvDq8ikWAM' },
  openai: { ttsModel: 'tts-1', voiceId: 'alloy' },
};

async function extractErrorMessage(response) {
  try {
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await response.json();
      return body?.error?.message || body?.detail?.message || body?.detail || body?.message || JSON.stringify(body);
    }
    const txt = await response.text();
    return txt || `HTTP ${response.status} ${response.statusText}`;
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────
// mode: 'voice' | 'sound' | 'music'
// Returns { buffer, mimeType, durationMs }
async function generateAudio({ mode, provider, apiKey, text, voiceId, ttsModel, musicModel, durationSeconds }) {
  if (!apiKey) throw new Error(`Kein API-Key für ${provider} konfiguriert.`);
  if (!text || !text.trim()) throw new Error('Text/Prompt erforderlich');

  if (mode === 'voice') {
    if (provider === 'openai') return _openaiTTS({ apiKey, text, voiceId, ttsModel });
    return _elevenTTS({ apiKey, text, voiceId, ttsModel });
  }
  if (mode === 'sound') return _elevenSound({ apiKey, text, durationSeconds });
  if (mode === 'music') return _elevenMusic({ apiKey, text, musicModel, durationSeconds });
  throw new Error(`Unbekannter Audio-Modus: ${mode}`);
}

async function validateAudioKey({ provider, apiKey }) {
  try {
    if (provider === 'elevenlabs') {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } });
      if (!res.ok) return { valid: false, error: await extractErrorMessage(res) };
      return { valid: true };
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) return { valid: false, error: await extractErrorMessage(res) };
      return { valid: true };
    }
    return { valid: false, error: `Unbekannter Provider: ${provider}` };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ─── ElevenLabs ──────────────────────────────────────────────────────────────

async function _elevenTTS({ apiKey, text, voiceId, ttsModel }) {
  const voice = voiceId || DEFAULT_AUDIO_MODELS.elevenlabs.voiceId;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: ttsModel || DEFAULT_AUDIO_MODELS.elevenlabs.ttsModel }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: 'audio/mpeg', durationMs: null };
}

async function _elevenSound({ apiKey, text, durationSeconds }) {
  const body = { text };
  if (durationSeconds) body.duration_seconds = Math.min(Math.max(durationSeconds, 0.5), 22);
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: 'audio/mpeg', durationMs: durationSeconds ? durationSeconds * 1000 : null };
}

async function _elevenMusic({ apiKey, text, musicModel, durationSeconds }) {
  const body = { prompt: text };
  if (durationSeconds) body.music_length_ms = Math.round(durationSeconds * 1000);
  if (musicModel) body.model_id = musicModel;
  const res = await fetch('https://api.elevenlabs.io/v1/music', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: 'audio/mpeg', durationMs: durationSeconds ? durationSeconds * 1000 : null };
}

// ─── OpenAI TTS ────────────────────────────────────────────────────────────

async function _openaiTTS({ apiKey, text, voiceId, ttsModel }) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ttsModel || DEFAULT_AUDIO_MODELS.openai.ttsModel,
      input: text,
      voice: voiceId || DEFAULT_AUDIO_MODELS.openai.voiceId,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: 'audio/mpeg', durationMs: null };
}

module.exports = { generateAudio, validateAudioKey, DEFAULT_AUDIO_MODELS };
