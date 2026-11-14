'use strict';

const KAGGLE_VIDEO_API_URL = process.env.KAGGLE_VIDEO_API_URL;
const KAGGLE_VIDEO_API_KEY = process.env.KAGGLE_VIDEO_API_KEY;
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'wan-2.2-ti2v-5b';

class NotConfiguredError extends Error {
  constructor(msg) { super(msg); this.name = 'NotConfiguredError'; }
}

function requireConfig() {
  if (!KAGGLE_VIDEO_API_URL || KAGGLE_VIDEO_API_URL.includes('YOUR_') || KAGGLE_VIDEO_API_URL.trim() === '') {
    throw new NotConfiguredError('KAGGLE_VIDEO_API_URL is not configured. Point it at your Kaggle notebook inference API.');
  }
  if (!KAGGLE_VIDEO_API_KEY || KAGGLE_VIDEO_API_KEY.includes('YOUR_') || KAGGLE_VIDEO_API_KEY.trim() === '') {
    throw new NotConfiguredError('KAGGLE_VIDEO_API_KEY is not configured.');
  }
  return { base: KAGGLE_VIDEO_API_URL.replace(/\/+$/, ''), key: KAGGLE_VIDEO_API_KEY };
}

async function generateClip(prompt, options = {}) {
  const { base, key } = requireConfig();
  const durationSeconds = options.durationSeconds || 6;
  const aspectRatio = options.aspectRatio || '16:9';

  const res = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: VIDEO_MODEL, prompt, duration_seconds: durationSeconds, aspect_ratio: aspectRatio })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    const err = new Error(`Kaggle video API responded with HTTP ${res.status}`);
    err.status = res.status; err.detail = detail; throw err;
  }

  const data = await res.json();
  if (!data || !data.job_id) throw new Error('Kaggle video API did not return a job_id.');
  return { jobId: data.job_id, status: data.status || 'submitted', raw: data };
}

async function getJobStatus(jobId, options = {}) {
  const { base, key } = requireConfig();
  const res = await fetch(`${base}/status/${encodeURIComponent(jobId)}`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${key}` }
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    const err = new Error(`Kaggle video status poll responded with HTTP ${res.status}`);
    err.status = res.status; err.detail = detail; throw err;
  }

  const data = await res.json();
  const status = (data.status || 'pending').toLowerCase();
  return { status, videoUrl: data.video_url || data.videoUrl || null, error: data.error || null, progress: data.progress || null, raw: data };
}

function getCapabilities() {
  return { engine: 'kaggle', model: VIDEO_MODEL, maxClipSeconds: 6, supportsImageToVideo: false, supportsAudio: false,
    note: 'Kaggle free GPU: time-limited sessions, not always-on production.' };
}

module.exports = { KAGGLE_VIDEO_API_URL, KAGGLE_VIDEO_API_KEY, VIDEO_MODEL, NotConfiguredError, generateClip, getJobStatus, getCapabilities, requireConfig };
