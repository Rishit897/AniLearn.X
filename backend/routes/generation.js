'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

router.get('/eligibility', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data, error } = await sb.rpc('check_generation_eligibility', { p_user_id: req.user.id });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) || { eligible: false, job_id: null, message: 'Unknown' };
    return res.json({ ok: true, eligible: !!row.eligible, activeJobId: row.job_id, message: row.message });
  } catch (err) {
    return res.status(500).json({ error: 'Could not check eligibility.', message: err.message });
  }
});

// POST /api/generation/start
router.post('/start', authenticate, rateLimit.generationLimiter, async (req, res) => {
  const {
    title, subject, classLevel, topic, script, duration,
    language, animeStyle, narrationLanguage, subtitleLanguage, features
  } = req.body;

  if (!title || !topic || !duration) {
    return res.status(400).json({ error: 'title, topic and duration are required.' });
  }
  if (!['short', 'medium', 'long'].includes(duration)) {
    return res.status(400).json({ error: "duration must be 'short', 'medium' or 'long'." });
  }

  try {
    const sb = require('../services/storage').getAdmin();

    const { data: proj, error: pErr } = await sb.from('projects').insert({
      user_id: req.user.id, title, subject: subject || null, class: classLevel || null,
      topic, script: script || null, selected_duration: duration,
      language: narrationLanguage || 'en', anime_style: animeStyle || null, status: 'pending'
    }).select('id').single();
    if (pErr) throw pErr;

    const { data: claim, error: cErr } = await sb.rpc('claim_generation_slot', { p_user_id: req.user.id, p_project_id: proj.id });
    if (cErr) throw cErr;
    if (!claim || !claim.ok) {
      return res.status(409).json({
        ok: false, eligible: false,
        message: (claim && claim.message) ? claim.message : 'Generation rejected.',
        activeJobId: (claim && claim.job_id) ? claim.job_id : null
      });
    }

    const { error: uErr } = await sb.from('generation_jobs').update({ status: 'processing', current_stage: 'starting' }).eq('id', claim.job_id);
    if (uErr) throw uErr;

    return res.json({ ok: true, eligible: true, jobId: claim.job_id, projectId: proj.id, message: 'Generation job accepted. Processing in the background.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not start generation.', message: err.message });
  }
});

// GET /api/generation/quota — returns the user's lock + cooldown state (for the timer widget)
router.get('/quota', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data, error } = await sb.from('video_quotas').select('*').eq('user_id', req.user.id).single();
    if (error && error.code !== 'PGRST116') throw error;
    return res.json({ ok: true, quota: data || null });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load quota.', message: err.message });
  }
});

// GET /api/generation/status/:jobId
router.get('/status/:jobId', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data, error } = await sb.from('generation_jobs').select('id, status, current_stage, started_at, completed_at, failure_details, provider_job_ref').eq('id', req.params.jobId).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Job not found.' });
    return res.json({ ok: true, job: data });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch job status.', message: err.message });
  }
});

module.exports = router;
