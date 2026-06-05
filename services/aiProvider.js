'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// ─── Default models per provider ─────────────────────────────────────────────

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai:    'gpt-5.5',
  mistral:   'mistral-large-latest',
  gemini:    'gemini-3.5-flash',
};

// ─── Helper: parse SSE stream from a fetch Response ──────────────────────────

async function* parseSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        yield line.slice(6).trim();
      }
    }
  }

  // flush remaining
  if (buffer.startsWith('data: ')) {
    yield buffer.slice(6).trim();
  }
}

// ─── Helper: extract error message from HTTP response ────────────────────────

async function extractErrorMessage(response) {
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || body?.detail || JSON.stringify(body);
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
}

// ─── Build OpenAI-compatible messages array ───────────────────────────────────

function buildOpenAIMessages(messages, systemPrompt) {
  const result = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  for (const m of messages) {
    // For non-Anthropic providers, image blocks are not supported — collapse to text
    if (Array.isArray(m.content)) {
      const textParts = m.content
        .map(block => {
          if (block.type === 'text') return block.text;
          if (block.type === 'image') return '[Bild-Anhang]';
          return '';
        })
        .filter(Boolean)
        .join('\n');
      result.push({ role: m.role, content: textParts });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

// ─── Build Gemini messages array ─────────────────────────────────────────────

function buildGeminiContents(messages) {
  return messages.map(m => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    let text;
    if (Array.isArray(m.content)) {
      text = m.content
        .map(block => {
          if (block.type === 'text') return block.text;
          if (block.type === 'image') return '[Bild-Anhang]';
          return '';
        })
        .filter(Boolean)
        .join('\n');
    } else {
      text = m.content;
    }
    return { role, parts: [{ text }] };
  });
}

// ─── streamGenerate ───────────────────────────────────────────────────────────
// Streams text chunks via onChunk callback, returns full generated text.

async function streamGenerate({ provider, apiKey, model, messages, systemPrompt, onChunk }) {
  provider = provider || 'anthropic';
  model    = model    || DEFAULT_MODELS[provider];

  if (provider === 'anthropic') {
    return _streamAnthropic({ apiKey, model, messages, systemPrompt, onChunk });
  } else if (provider === 'openai') {
    return _streamOpenAICompat({ url: 'https://api.openai.com/v1/chat/completions', apiKey, model, messages, systemPrompt, onChunk });
  } else if (provider === 'mistral') {
    return _streamOpenAICompat({ url: 'https://api.mistral.ai/v1/chat/completions', apiKey, model, messages, systemPrompt, onChunk });
  } else if (provider === 'gemini') {
    return _streamGemini({ apiKey, model, messages, systemPrompt, onChunk });
  } else {
    throw new Error(`Unbekannter AI-Provider: ${provider}`);
  }
}

// ─── generateText ─────────────────────────────────────────────────────────────
// Returns full generated string without streaming.

async function generateText({ provider, apiKey, model, messages, systemPrompt, json = false }) {
  provider = provider || 'anthropic';
  model    = model    || DEFAULT_MODELS[provider];

  if (provider === 'anthropic') {
    return _generateTextAnthropic({ apiKey, model, messages, systemPrompt, json });
  } else if (provider === 'openai') {
    return _generateTextOpenAICompat({ url: 'https://api.openai.com/v1/chat/completions', apiKey, model, messages, systemPrompt, json });
  } else if (provider === 'mistral') {
    return _generateTextOpenAICompat({ url: 'https://api.mistral.ai/v1/chat/completions', apiKey, model, messages, systemPrompt, json });
  } else if (provider === 'gemini') {
    return _generateTextGemini({ apiKey, model, messages, systemPrompt, json });
  } else {
    throw new Error(`Unbekannter AI-Provider: ${provider}`);
  }
}

// ─── validateKey ──────────────────────────────────────────────────────────────

async function validateKey({ provider, apiKey }) {
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      return { valid: true };
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!res.ok) return { valid: false, error: await extractErrorMessage(res) };
      return { valid: true };
    } else if (provider === 'mistral') {
      const res = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!res.ok) return { valid: false, error: await extractErrorMessage(res) };
      return { valid: true };
    } else if (provider === 'gemini') {
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

// ─── Anthropic implementation ─────────────────────────────────────────────────

async function _streamAnthropic({ apiKey, model, messages, systemPrompt, onChunk }) {
  if (!apiKey) throw new Error('Kein API-Key für Anthropic angegeben');
  const client = new Anthropic({ apiKey });

  const maxTokens = model.includes('haiku') ? 8000 : 32000;
  const streamParams = { model, max_tokens: maxTokens, messages };
  if (systemPrompt) streamParams.system = systemPrompt;

  const stream = await client.messages.stream(streamParams);

  let fullContent = '';
  let stopReason = null;

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullContent += chunk.delta.text;
      if (onChunk) onChunk(chunk.delta.text);
    }
    if (chunk.type === 'message_delta' && chunk.delta.stop_reason) {
      stopReason = chunk.delta.stop_reason;
    }
  }

  return { text: fullContent, stopReason };
}

async function _generateTextAnthropic({ apiKey, model, messages, systemPrompt, json = false }) {
  if (!apiKey) throw new Error('Kein API-Key für Anthropic angegeben');
  const client = new Anthropic({ apiKey });

  const maxTokens = model.includes('haiku') ? 8000 : 32000;
  // Force JSON via assistant prefill: the model continues from "{", so the
  // reply is guaranteed to be a JSON object (no markdown/prose). We prepend the
  // "{" back to the returned continuation.
  const msgs = json ? [...messages, { role: 'assistant', content: '{' }] : messages;
  const params = { model, max_tokens: maxTokens, messages: msgs };
  if (systemPrompt) params.system = systemPrompt;

  const response = await client.messages.create(params);
  const text = response.content[0]?.text || '';
  return json ? '{' + text : text;
}

// ─── OpenAI-compatible implementation (OpenAI + Mistral) ─────────────────────

async function _streamOpenAICompat({ url, apiKey, model, messages, systemPrompt, onChunk }) {
  if (!apiKey) throw new Error(`Kein API-Key angegeben`);

  const oaiMessages = buildOpenAIMessages(messages, systemPrompt);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: oaiMessages, stream: true, max_tokens: 16000 }),
  });

  if (!response.ok) {
    const errMsg = await extractErrorMessage(response);
    throw new Error(errMsg);
  }

  let fullContent = '';
  let stopReason = null;

  for await (const raw of parseSSE(response)) {
    if (raw === '[DONE]') break;
    try {
      const data = JSON.parse(raw);
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        if (onChunk) onChunk(delta);
      }
      const finishReason = data.choices?.[0]?.finish_reason;
      if (finishReason) stopReason = finishReason;
    } catch {
      // ignore parse errors on non-JSON SSE lines
    }
  }

  return { text: fullContent, stopReason };
}

async function _generateTextOpenAICompat({ url, apiKey, model, messages, systemPrompt, json = false }) {
  if (!apiKey) throw new Error(`Kein API-Key angegeben`);

  const oaiMessages = buildOpenAIMessages(messages, systemPrompt);

  const body = { model, messages: oaiMessages, max_tokens: 16000 };
  // OpenAI & Mistral both support strict JSON output. (Requires the word "json"
  // in the prompt — the planning prompt contains it.)
  if (json) body.response_format = { type: 'json_object' };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errMsg = await extractErrorMessage(response);
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Gemini implementation ────────────────────────────────────────────────────

async function _streamGemini({ apiKey, model, messages, systemPrompt, onChunk }) {
  if (!apiKey) throw new Error('Kein API-Key für Gemini angegeben');

  const contents = buildGeminiContents(messages);
  const body = { contents };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errMsg = await extractErrorMessage(response);
    throw new Error(errMsg);
  }

  let fullContent = '';
  let stopReason = null;

  for await (const raw of parseSSE(response)) {
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        fullContent += text;
        if (onChunk) onChunk(text);
      }
      const fr = data.candidates?.[0]?.finishReason;
      if (fr) stopReason = fr;
    } catch {
      // ignore parse errors
    }
  }

  return { text: fullContent, stopReason };
}

async function _generateTextGemini({ apiKey, model, messages, systemPrompt, json = false }) {
  if (!apiKey) throw new Error('Kein API-Key für Gemini angegeben');

  const contents = buildGeminiContents(messages);
  const body = { contents };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  if (json) body.generationConfig = { responseMimeType: 'application/json' };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errMsg = await extractErrorMessage(response);
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

module.exports = {
  streamGenerate,
  generateText,
  validateKey,
  DEFAULT_MODELS,
};
