'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { createSignedUrl, BUCKET_VIDEOS, BUCKET_THUMBS, removeFile } = require('../services/storage');

router.get('/', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { subject, status, duration, search, from, to, limit = 50, offset = 0 } = req.query;
    const off = parseInt(offset, 10) || 0;
    const lim = parseInt(limit, 10) || 50;

    let q = sb.from('projects').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).range(off, off + lim - 1);
    if (subject) q = q.ilike('subject', `%${subject}%`);
    if (status) q = q.eq('status', status);
    if (duration) q = q.eq('selected_duration', duration);
    if (search) q = q.ilike('title', `%${search}%`);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to);

    const { data, error } = await q;
    if (error) throw error;
    return res.json({ ok: true, projects: data || [], count: (data || []).length });
  } catch (err) {
    return res.status(500).json({ error: 'Could not list projects.', message: err.message });
  }
});

// GET /api/projects/:id
router.get('/:id', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data: project, error } = await sb.from('projects').select('*, generation_jobs(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    let videoUrl = project.video_url;
    if (!videoUrl && project.video_path) {
      try {
        const { signedUrl } = await createSignedUrl(BUCKET_VIDEOS, project.video_path, 3600);
        videoUrl = signedUrl;
      } catch { /* signed URL unavailable */ }
    }

    return res.json({ ok: true, project: { ...project, videoUrl } });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load project.', message: err.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data: project, error } = await sb.from('projects').select('video_path, thumbnail_path').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    if (project.video_path) try { await removeFile(BUCKET_VIDEOS, project.video_path); } catch { /* ignore */ }
    if (project.thumbnail_path) try { await removeFile(BUCKET_THUMBS, project.thumbnail_path); } catch { /* ignore */ }

    const { error: delErr } = await sb.from('projects').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (delErr) throw delErr;
    return res.json({ ok: true, message: 'Project deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete project.', message: err.message });
  }
});

module.exports = router;
