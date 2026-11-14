'use strict';

/**
 * Modular TTS service for AniLearn.X.
 *
 * Active provider: Piper (OHF-Voice/piper1-gpl) via local HTTP service.
 * Default endpoint: http://127.0.0.1:5000, POST /synthesize -> WAV audio.
 *
 * The provider is selected by TTS_PROVIDER and kept modular so synthesis can
 * be moved to a separate/private worker service in production without changing
 * callers (worker calls synthesize() and receives an audio file path).
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const TTS_PROVIDER = (process.env.TTS_PROVIDER || 'piper').toLowerCase().trim();
const PIPER_TTS_URL = (process.env.PIPER_TTS_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const PIPER_VOICE = process.env.PIPER_VOICE || '';
const TTS_TIMEOUT_MS = parseInt(process.env.TTS_TIMEOUT_MS || '120000', 10);
const TTS_TMP_DIR = process.env.TTS_TMP_DIR || path.join(require('os').tmpdir(), 'anilearn-tts');

class TTSError extends Error {
  constructor(msg, code) { super(msg); this.name = 'TTSError'; this.code = code; }
}
class NotConfiguredError extends TTSError {
  constructor(msg) { super(msg, 'not_configured'); this.name = 'NotConfiguredError'; }
}
class ServiceUnavailableError extends TTSError {
  constructor(msg) { super(msg, 'service_unavailable'); this.name = 'ServiceUnavailableError'; }
}

function ensureTmpDir(dir) {
  const outDir = dir || TTS_TMP_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function isWav(buffer) {
  if (!buffer || buffer.length < 12) return false;
  return buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WAVE';
}

function buildWavPath(outDir) {
  return path.join(outDir, `narration_${Date.now()}_${randomUUID().slice(0, 8)}.wav`);
}

/**
 * Synthesize narration text to a WAV file.
 *
 * @param {string} text
 * @param {object} options
 * @param {string} [options.provider] - TTS provider (default: env TTS_PROVIDER)
 * @param {string} [options.voice] - Piper voice/model name (default: env PIPER_VOICE)
 * @param {number} [options.speed] - Speaking speed/length scale hint for Piper
 * @param {number} [options.speakingRate] - Alias for speed
 * @param {string} [options.outputDir] - Directory to save WAV into
 * @param {number} [options.timeoutMs] - HTTP timeout
 * @returns {Promise<{ audioPath: string, contentType: string, provider: string, voice: string|null, bytes: number }>}
 */
async function synthesize(text, options = {}) {
  const provider = (options.provider || TTS_PROVIDER || 'piper').toLowerCase().trim();
  if (!provider || provider === 'none') {
    throw new NotConfiguredError('TTS_PROVIDER is not set. Configure piper in .env.');
  }

  const cleanText = typeof text === 'string' ? text.trim() : '';
  if (!cleanText) throw new TTSError('Narration text is empty.', 'invalid_input');

  switch (provider) {
    case 'piper':
      return synthesizePiper(cleanText, options);
    default:
      throw new NotConfiguredError(`Unsupported TTS_PROVIDER: ${provider}. Active provider is 'piper'.`);
  }
}

async function synthesizePiper(text, options = {}) {
  const url = `${PIPER_TTS_URL}/synthesize`;
  const voice = options.voice || options.voiceName || PIPER_VOICE || undefined;
  const speed = options.speed ?? options.speakingRate ?? options.lengthScale ?? 1.0;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : TTS_TIMEOUT_MS;
  const outDir = ensureTmpDir(options.outputDir);

  const body = { text };
  if (voice) body.voice = voice;
  if (speed != null && speed !== '' && !Number.isNaN(Number(speed))) {
    const s = Number(speed);
    // Piper length_scale: higher = slower. Treat speed as speaking rate (1.0 normal, >1 faster).
    body.length_scale = s > 0 ? 1 / s : 1.0;
    body.speed = s;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/wav, application/octet-stream' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new TTSError(`Piper TTS request timed out after ${timeoutMs}ms (${url}).`, 'timeout');
    }
    throw new ServiceUnavailableError(`Piper TTS service unavailable at ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    const snippet = detail.length > 300 ? `${detail.slice(0, 300)}...` : detail;
    throw new TTSError(`Piper TTS synthesis failed (HTTP ${res.status}) at ${url}: ${snippet}`, 'http_error');
  }

  const arrayBuffer = await res.arrayBuffer().catch((err) => {
    throw new TTSError(`Failed to read Piper TTS response: ${err.message}`, 'invalid_response');
  });
  const buffer = Buffer.from(arrayBuffer);

  if (!buffer.length) throw new TTSError('Piper TTS returned an empty audio response.', 'invalid_response');

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('json') || contentType.includes('text/html')) {
    const detail = buffer.toString('utf8').slice(0, 300);
    throw new TTSError(`Piper TTS returned non-audio content (${contentType}): ${detail}`, 'invalid_response');
  }
  if (!isWav(buffer)) {
    throw new TTSError('Piper TTS returned invalid audio: expected WAV (RIFF/WAVE).', 'invalid_response');
  }

  const audioPath = buildWavPath(outDir);
  try {
    fs.writeFileSync(audioPath, buffer);
  } catch (err) {
    throw new TTSError(`Failed to save Piper TTS WAV file: ${err.message}`, 'io_error');
  }

  const stat = fs.statSync(audioPath);
  if (!stat.size) throw new TTSError('Saved Piper TTS WAV file is empty.', 'io_error');

  return {
    audioPath,
    contentType: 'audio/wav',
    provider: 'piper',
    voice: voice || null,
    bytes: stat.size
  };
}

// Backward-compatible status helpers (Piper requires no API key).
function getStatus() {
  return {
    provider: TTS_PROVIDER || 'piper',
    configured: (TTS_PROVIDER || 'piper') === 'piper',
    endpoint: PIPER_TTS_URL,
    voice: PIPER_VOICE || null
  };
}

module.exports = {
  TTS_PROVIDER,
  PIPER_TTS_URL,
  PIPER_VOICE,
  TTS_TIMEOUT_MS,
  TTS_TMP_DIR,
  TTSError,
  NotConfiguredError,
  ServiceUnavailableError,
  synthesize,
  synthesizePiper,
  ensureTmpDir,
  getStatus
};
