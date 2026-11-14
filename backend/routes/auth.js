'use strict';

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authenticate } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const IS_PROD = process.env.NODE_ENV === 'production';

let supabaseAnon = null;
function getAnon() {
  if (!supabaseAnon) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR_') || SUPABASE_ANON_KEY.includes('YOUR_')) {
      throw new Error('Supabase URL / ANON_KEY not configured.');
    }
    supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return supabaseAnon;
}

function userClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

function cookieOpts(extra) {
  const secure = IS_PROD ? '; Secure' : '';
  return `; HttpOnly${secure}; SameSite=Lax${extra || ''}`;
}

function setSessionCookies(res, session) {
  const accessMaxAge = session.expires_in ? parseInt(session.expires_in, 10) : 3600;
  res.setHeader('Set-Cookie', [
    `anilearn_access_token=${session.access_token}; Path=/; Max-Age=${accessMaxAge}${cookieOpts()}`,
    `anilearn_refresh_token=${session.refresh_token || ''}; Path=/; Max-Age=604800${cookieOpts()}`
  ]);
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    'anilearn_access_token=; Path=/; Max-Age=0' + cookieOpts(),
    'anilearn_refresh_token=; Path=/; Max-Age=0' + cookieOpts()
  ]);
}

function getAccessTokenFromReq(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  const cookies = (req.headers.cookie || '').split(';').map(c => c.trim());
  const access = cookies.find(c => c.startsWith('anilearn_access_token='));
  return access ? access.split('=').slice(1).join('=') : null;
}

function sessionResponse(res, session) {
  return res.json({
    ok: true,
    user: { id: session.user.id, email: session.user.email, aud: session.user.aud, role: session.user.role }
  });
}

// GET /api/auth/me
router.get('/me', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = userClient(req.accessToken);
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) return res.status(401).json({ error: 'Session not valid.' });
    let profile = null;
    try {
      const { data: p } = await sb.from('user_profiles').select('*').eq('id', data.user.id).single();
      profile = p;
    } catch { /* profile may not exist yet */ }
    return res.json({ ok: true, user: data.user, profile });
  } catch (err) {
    return res.status(500).json({ error: 'Session verification failed.', message: err.message });
  }
});

// NOTE: Google/social OAuth is intentionally not exposed. Authentication uses Supabase email
// magic links / OTP (passwordless) to avoid Google Cloud Console dependencies. Supabase may
// still support other providers if configured without Google Cloud; none are enabled here.

// GET /api/auth/oauth-callback — exchanges Supabase auth code for a session (email magic link / PKCE flows)
router.get('/oauth-callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) {
    clearSessionCookies(res);
    return res.redirect(`${PUBLIC_BASE_URL}/?auth_error=oauth_error&message=${encodeURIComponent(error_description || error)}`);
  }
  if (!code) {
    clearSessionCookies(res);
    return res.redirect(`${PUBLIC_BASE_URL}/?auth_error=missing_code`);
  }
  try {
    const { data, error: err } = await getAnon().auth.exchangeCodeForSession({ code });
    if (err || !data.session) throw err || new Error('No session returned.');
    setSessionCookies(res, data.session);
    try {
      const sb = userClient(data.session.access_token);
      const { data: existing } = await sb.from('user_profiles').select('id').eq('id', data.session.user.id).single();
      if (!existing) {
        await sb.from('user_profiles').insert({
          id: data.session.user.id,
          email: data.session.user.email,
          display_name: (data.session.user.user_metadata && data.session.user.user_metadata.full_name) || data.session.user.email
        });
      }
    } catch { /* non-fatal */ }
    return res.redirect(`${PUBLIC_BASE_URL}/create`);
  } catch (err) {
    clearSessionCookies(res);
    return res.redirect(`${PUBLIC_BASE_URL}/?auth_error=exchange_failed&message=${encodeURIComponent(err.message)}`);
  }
});

// POST /api/auth/email/send — magic link delivery
router.post('/email/send', rateLimit.authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  try {
    const emailRedirectTo = `${PUBLIC_BASE_URL}/api/auth/oauth-callback`;
    const { error } = await getAnon().auth.signInWithOtp({ email, options: { emailRedirectTo } });
    if (error) throw error;
    return res.json({ ok: true, message: 'If an account exists for this email, a sign-in link has been delivered.' });
  } catch (err) {
    return res.json({ ok: true, message: 'If an account exists for this email, a sign-in link has been delivered.' });
  }
});

// POST /api/auth/email/verify — verify OTP code
router.post('/email/verify', rateLimit.authLimiter, async (req, res) => {
  const { email, token } = req.body;
  if (!email || !token) return res.status(400).json({ error: 'Email and OTP token are required.' });
  try {
    const { data, error } = await getAnon().auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data.session) throw error || new Error('Invalid or expired OTP.');
    setSessionCookies(res, data.session);
    return sessionResponse(res, data.session);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired OTP code.', message: err.message });
  }
});

// POST /api/auth/refresh
router.post('/refresh', rateLimit.authLimiter, async (req, res) => {
  const { data, error } = await getAnon().auth.refreshSession({ refresh_token: req.body.refresh_token || '' });
  if (error || !data.session) {
    clearSessionCookies(res);
    return res.status(401).json({ error: 'Session could not be refreshed. Please sign in again.' });
  }
  setSessionCookies(res, data.session);
  return sessionResponse(res, data.session);
});

// POST /api/auth/logout
router.post('/logout', authenticate, rateLimit.authLimiter, async (req, res) => {
  try {
    const sb = userClient(req.accessToken);
    await sb.auth.signOut();
  } catch { /* ignore */ }
  clearSessionCookies(res);
  return res.json({ ok: true, message: 'Signed out.' });
});

// DELETE /api/auth/account — real account deletion (service role, user-scoped)
router.delete('/account', authenticate, rateLimit.authLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { error } = await sb.auth.admin.deleteUser(req.user.id);
    if (error) throw error;
    clearSessionCookies(res);
    return res.json({ ok: true, message: 'Account permanently deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete account.', message: err.message });
  }
});

// POST /api/auth/legal-acceptance
router.post('/legal-acceptance', authenticate, rateLimit.authLimiter, async (req, res) => {
  const { terms_version, privacy_version, age_verified, parental_consent } = req.body;
  if (!terms_version || !privacy_version) return res.status(400).json({ error: 'terms_version and privacy_version are required.' });
  try {
    const sb = userClient(req.accessToken);
    const { data, error } = await sb.from('legal_acceptances').insert({
      user_id: req.user.id, terms_version, privacy_version,
      age_verified: !!age_verified, parental_consent: !!parental_consent
    }).select().single();
    if (error) throw error;
    return res.json({ ok: true, acceptance: data });
  } catch (err) {
    return res.status(500).json({ error: 'Could not record legal acceptance.', message: err.message });
  }
});

module.exports = router;
