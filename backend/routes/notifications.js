'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const VALID_METHODS = ['email', 'dashboard'];

function normalizeMethod(method) {
  const m = (method || '').toLowerCase().trim();
  // Legacy values (whatsapp/both) map to email-only to avoid unsupported channels.
  if (m === 'whatsapp' || m === 'both') return 'email';
  return m;
}

router.get('/preferences', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data, error } = await sb.from('notification_preferences').select('*').eq('user_id', req.user.id).single();
    if (error && error.code !== 'PGRST116') throw error;
    const prefs = data || { method: 'dashboard', email: false, whatsapp_phone: null, whatsapp_consent: false };
    if (prefs.method === 'whatsapp' || prefs.method === 'both') prefs.method = 'email';
    prefs.whatsapp_phone = null;
    prefs.whatsapp_consent = false;
    return res.json({ ok: true, preferences: prefs });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load notification preferences.', message: err.message });
  }
});

router.post('/preferences', authenticate, rateLimit.generalLimiter, async (req, res) => {
  const method = normalizeMethod(req.body && req.body.method);
  const { emailEnabled } = req.body || {};
  if (!VALID_METHODS.includes(method)) {
    return res.status(400).json({ error: "method must be 'email' or 'dashboard'." });
  }
  try {
    const sb = require('../services/storage').getAdmin();
    const payload = {
      user_id: req.user.id,
      method,
      whatsapp_phone: null,
      whatsapp_consent: false,
      whatsapp_consent_at: null,
      email: method === 'email' ? true : !!emailEnabled
    };
    const { data, error } = await sb.from('notification_preferences').upsert(payload, { onConflict: 'user_id' }).select().single();
    if (error) throw error;
    return res.json({ ok: true, preferences: data });
  } catch (err) {
    return res.status(500).json({ error: 'Could not save notification preferences.', message: err.message });
  }
});

router.get('/logs', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data, error } = await sb.from('notification_logs').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return res.json({ ok: true, logs: data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load notification logs.', message: err.message });
  }
});

module.exports = router;
