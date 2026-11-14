'use strict';

/**
 * Text generation service for ANI chat and script generation.
 * Provider: Ollama (local open-source models) — no Google Cloud / no hosted AI billing dependency.
 *
 * Configure via .env:
 *   LLM_PROVIDER=ollama
 *   OLLAMA_URL=http://127.0.0.1:11434
 *   OLLAMA_MODEL=llama3.2:3b  (or another small model, e.g. phi3:mini, qwen2.5:3b)
 */

const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'ollama').toLowerCase().trim();
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

class NotConfiguredError extends Error {
  constructor(msg) { super(msg); this.name = 'NotConfiguredError'; }
}

async function generateText(prompt, options = {}) {
  const provider = (options.provider || LLM_PROVIDER || 'ollama').toLowerCase().trim();
  switch (provider) {
    case 'ollama': return generateTextOllama(prompt, options);
    default:
      throw new NotConfiguredError(`Unsupported LLM_PROVIDER: ${provider}. Use 'ollama' (local open-source model).`);
  }
}

async function generateTextOllama(prompt, options = {}) {
  const model = options.model || OLLAMA_MODEL;
  const systemInstruction = options.systemInstruction || '';
  const temperature = options.temperature != null ? options.temperature : 0.7;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature },
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '(no body)');
      const err = new Error(`Ollama API responded with HTTP ${res.status} (${OLLAMA_URL}).`);
      err.status = res.status; err.detail = detail; throw err;
    }
    const data = await res.json();
    const text = data?.message?.content || data?.response;
    if (!text || !String(text).trim()) throw new Error('Ollama returned an empty response.');
    return String(text);
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`Ollama request timed out after ${timeoutMs}ms.`);
    if (err && (err.code === 'ECONNREFUSED' || /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(err.message || ''))) {
      throw new NotConfiguredError(`Ollama is not reachable at ${OLLAMA_URL}. Install/start Ollama and pull a model (e.g. "ollama pull ${OLLAMA_MODEL}").`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function generateJson(prompt, options = {}) {
  const text = await generateText(prompt, options);
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  try { return JSON.parse(raw); } catch (err) { throw new Error(`LLM did not return valid JSON: ${err.message}`); }
}

function buildScriptPrompt(inputs) {
  const { topic, sourceText, subject, classLevel, duration, narrationLanguage, animeStyle, difficulty, creativity, drama, features = {} } = inputs;
  const durationMinutes = { short: 5, medium: 7, long: 10 }[duration] || 5;

  return `
You are an expert educational scriptwriter and anime director. Write a complete educational anime video script in ${narrationLanguage}.

EDUCATIONAL CONTENT:
Topic: ${topic}
Subject: ${subject}
Class/Grade: ${classLevel}
Source material: ${sourceText || '(none — rely on the topic)'}

VIDEO PARAMETERS:
Target duration: approximately ${durationMinutes} minutes (${duration})
Anime style: ${animeStyle}
Difficulty: ${difficulty}
Creativity: ${creativity}/10
Drama intensity: ${drama}/10
Features: ${Object.entries(features).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none'}

TASK:
1. Produce an accurate educational explanation of the topic.
2. Convert it into an anime learning adventure with a student protagonist and a teacher/mentor.
3. Divide into scenes. Each scene ~45-75 seconds so the full video totals close to ${durationMinutes} minutes.
4. For every scene provide: scene number, title, visual description (anime scene artwork prompt), character actions, dialogue, educational concept, estimated seconds.
5. End with a short quiz (3-5 questions).

OUTPUT FORMAT — return ONLY valid JSON:
{
  "title": "...",
  "explanation": "...",
  "estimatedDurationMinutes": ${durationMinutes},
  "scenes": [
    { "scene": 1, "title": "...", "concept": "...", "visualPrompt": "...", "characters": ["..."],
      "dialogue": [{"speaker":"...","line":"..."}], "estimatedSeconds": 60 }
  ],
  "quiz": [{"q":"...","options":["..."],"answer":"..."}]
}
`;
}

function getStatus() {
  return { provider: LLM_PROVIDER, ollamaUrl: OLLAMA_URL, ollamaModel: OLLAMA_MODEL };
}

module.exports = {
  LLM_PROVIDER, OLLAMA_URL, OLLAMA_MODEL,
  NotConfiguredError, generateText, generateTextOllama, generateJson, buildScriptPrompt, getStatus
};
