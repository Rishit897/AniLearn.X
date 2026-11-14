'use strict';

/**
 * Modular image generation service.
 * Supported provider: self-hosted/open-source HTTP endpoint you control (IMAGE_PROVIDER=http).
 * Paid/closed hosted image APIs are intentionally not implemented.
 *
 * Recommended contract:
 *   POST IMAGE_PROVIDER_URL (or .../generate)
 *   Body: { "prompt": "...", "width": 1280, "height": 720, "format": "png" }
 *   Response: image/* bytes OR JSON with base64 (image_base64/b64_json/base64/images[0]) OR image URL (image_url/url).
 */

const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'none').toLowerCase().trim();
const IMAGE_PROVIDER_URL = (process.env.IMAGE_PROVIDER_URL || '').trim();
const IMAGE_PROVIDER_API_KEY = process.env.IMAGE_PROVIDER_API_KEY || '';
const IMAGE_TIMEOUT_MS = parseInt(process.env.IMAGE_TIMEOUT_MS || '120000', 10);

class NotConfiguredError extends Error {
  constructor(msg) { super(msg); this.name = 'NotConfiguredError'; }
}

function isConfigured(v) {
  return v && typeof v === 'string' && v.trim() !== '' && !v.includes('YOUR_');
}

function getGenerateUrl() {
  if (!isConfigured(IMAGE_PROVIDER_URL)) {
    throw new NotConfiguredError('IMAGE_PROVIDER_URL is not configured. Point it at a self-hosted/open-source image generation endpoint.');
  }
  const base = IMAGE_PROVIDER_URL.replace(/\/+$/, '');
  if (/\/(generate|txt2img|v1\/images)(\/|$)/i.test(base)) return base;
  return `${base}/generate`;
}

async function fetchImageBufferFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed HTTP ${res.status}`);
  const ct = (res.headers.get('content-type') || 'image/png').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('Downloaded image is empty.');
  return { imageBuffer: buf, contentType: ct.startsWith('image/') ? ct.split(';')[0] : 'image/png' };
}

async function generateImage(visualPrompt, options = {}) {
  const provider = (options.provider || IMAGE_PROVIDER || 'none').toLowerCase().trim();
  if (provider === 'none' || provider === '') {
    throw new NotConfiguredError('IMAGE_PROVIDER is not set. Configure IMAGE_PROVIDER=http and IMAGE_PROVIDER_URL for a self-hosted/open-source image service, or leave disabled.');
  }
  if (provider === 'openai' || provider === 'stability') {
    throw new NotConfiguredError(`Provider '${provider}' is not supported. Use a self-hosted open-source image endpoint (IMAGE_PROVIDER=http).`);
  }
  if (provider !== 'http') {
    throw new NotConfiguredError(`Unsupported IMAGE_PROVIDER: ${provider}. Supported: 'http' (self-hosted/open-source) or 'none'.`);
  }

  const animePrompt = `Anime style, high quality, educational anime scene: ${visualPrompt}. Vibrant, clean anime aesthetic, 16:9 composition, suitable for an educational video.`;
  const url = getGenerateUrl();
  const width = options.width || 1280;
  const height = options.height || 720;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : IMAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'image/*, application/json' };
    if (isConfigured(IMAGE_PROVIDER_API_KEY)) headers['Authorization'] = `Bearer ${IMAGE_PROVIDER_API_KEY}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: animePrompt, width, height, format: 'png' }),
      signal: controller.signal
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '(no body)');
      const err = new Error(`Image provider HTTP ${res.status} at ${url}`);
      err.status = res.status; err.detail = detail; throw err;
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('Image provider returned an empty image.');
      return { imageBuffer: buf, contentType: ct.split(';')[0] || 'image/png', provider: 'http' };
    }

    const data = await res.json().catch(() => null);
    if (!data) throw new Error('Image provider returned an invalid non-image, non-JSON response.');

    const b64 = data.image_base64 || data.b64_json || data.base64 || (Array.isArray(data.images) ? data.images[0] : null) || (Array.isArray(data.data) ? (data.data[0] && (data.data[0].b64_json || data.data[0].base64)) : null);
    if (b64 && typeof b64 === 'string') {
      const clean = b64.includes('base64,') ? b64.split('base64,').pop() : b64;
      const buf = Buffer.from(clean, 'base64');
      if (!buf.length) throw new Error('Image provider returned empty base64 image data.');
      return { imageBuffer: buf, contentType: data.contentType || 'image/png', provider: 'http' };
    }

    const outUrl = data.image_url || data.url || (Array.isArray(data.images) && typeof data.images[0] === 'string' && /^https?:/i.test(data.images[0]) ? data.images[0] : null);
    if (outUrl) {
      const dl = await fetchImageBufferFromUrl(outUrl);
      return { ...dl, provider: 'http' };
    }

    throw new Error('Image provider response did not include image bytes, base64 data, or an image URL.');
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`Image generation timed out after ${timeoutMs}ms (${url}).`);
    if (err && (err.code === 'ECONNREFUSED' || /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(err.message || ''))) {
      throw new NotConfiguredError(`Image provider is not reachable at ${url}. Start your self-hosted/open-source image service.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { IMAGE_PROVIDER, IMAGE_PROVIDER_URL, IMAGE_PROVIDER_API_KEY, IMAGE_TIMEOUT_MS, NotConfiguredError, generateImage, getGenerateUrl };
