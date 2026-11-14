'use strict';

/**
 * Completion notifications for AniLearn.X.
 * Supported channels: dashboard (in-app) and email via Resend (https://api.resend.com/emails).
 * WhatsApp/Meta and other providers are intentionally not implemented.
 */

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase().trim();
const EMAIL_PROVIDER_API_KEY = process.env.EMAIL_PROVIDER_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@yourdomain.com';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

class NotConfiguredError extends Error {
  constructor(msg) { super(msg); this.name = 'NotConfiguredError'; }
}

function isConfiguredKey(v) {
  return v && typeof v === 'string' && v.trim() !== '' && !v.includes('YOUR_');
}

async function sendEmail(toEmail, { projectTitle, videoUrl, userName = 'there' }) {
  const channel = 'email';
  if (!toEmail || typeof toEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { ok: false, channel, error: 'A valid recipient email address is required.' };
  }
  if (EMAIL_PROVIDER === 'none' || EMAIL_PROVIDER === '') {
    return { ok: false, channel, error: 'Email notifications are disabled (EMAIL_PROVIDER=none).' };
  }
  if (EMAIL_PROVIDER !== 'resend') {
    return { ok: false, channel, error: `Unsupported EMAIL_PROVIDER: ${EMAIL_PROVIDER}. Only 'resend' is supported.` };
  }
  if (!isConfiguredKey(EMAIL_PROVIDER_API_KEY)) {
    return { ok: false, channel, error: 'Resend email is not configured (missing EMAIL_PROVIDER_API_KEY).' };
  }

  const subject = `Your AniLearn.X video is ready: ${projectTitle || 'Untitled project'}`;
  const safeTitle = String(projectTitle || 'Untitled project');
  const safeName = String(userName || 'there');
  const link = videoUrl || PUBLIC_BASE_URL;
  const html = `<h2>Hello ${safeName}</h2><p>Your anime learning video <strong>${safeTitle}</strong> is ready.</p><p><a href="${link}" style="background:#06b6d4;color:#000;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700">Open your video</a></p><p>If the button does not work, open: ${link}</p>`;
  const text = `Hello ${safeName}\n\nYour anime learning video "${safeTitle}" is ready.\nOpen: ${link}`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${EMAIL_PROVIDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [toEmail], subject, html, text })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, channel, error: `Resend API HTTP ${res.status}`, providerResponse: data };
    }
    return { ok: true, channel, messageId: data.id || null, providerResponse: data };
  } catch (err) {
    return { ok: false, channel, error: `Resend request failed: ${err.message}` };
  }
}

async function sendCompletionNotification({ userId, method, toEmail, projectTitle, videoUrl, userName }) {
  const results = [];
  const m = (method || 'dashboard').toLowerCase().trim();
  // Email notifications are sent when requested; dashboard visibility is handled in-app.
  if (m === 'email' || m === 'both') {
    results.push(await sendEmail(toEmail, { projectTitle, videoUrl, userName }));
  }
  return { results };
}

module.exports = { PUBLIC_BASE_URL, NotConfiguredError, sendEmail, sendCompletionNotification };
