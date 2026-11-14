'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const ALLOWED_FIELDS = [
  'display_name', 'default_language', 'default_class', 'default_subject',
  'default_anime_style', 'default_duration', 'default_narration_language',
  'default_subtitle_language'
];

router.get('/', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data: profile, error: pErr } = await sb.from('user_profiles').select('*').eq('id', req.user.id).single();
    if (pErr && pErr.code !== 'PGRST116') throw pErr;

    const { data: prefs, error: nErr } = await sb.from('notification_preferences').select('method, whatsapp_phone, email').eq('user_id', req.user.id).single();
    if (nErr && nErr.code !== 'PGRST116') throw nErr;

    return res.json({
      ok: true,
      profile: profile || { id: req.user.id, email: req.user.email, default_language: 'en', default_duration: 'short' },
      notifications: prefs || { method: 'dashboard', whatsapp_phone: null, email: false }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load settings.', message: err.message });
  }
});

router.post('/', authenticate, rateLimit.generalLimiter, async (req, res) => {
  const updates = {};
  for (const f of ALLOWED_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No settings fields provided.' });
  updates.updated_at = new Date().toISOString();

  try {
    const sb = require('../services/storage').getAdmin();
    const { data: existing } = await sb.from('user_profiles').select('id').eq('id', req.user.id).single();
    let result;
    if (existing) {
      const { data, error } = await sb.from('user_profiles').update(updates).eq('id', req.user.id).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await sb.from('user_profiles').insert({ id: req.user.id, email: req.user.email, ...updates }).select().single();
      if (error) throw error;
      result = data;
    }
    return res.json({ ok: true, settings: result });
  } catch (err) {
    return res.status(500).json({ error: 'Could not save settings.', message: err.message });
  }
});

module.exports = router;
