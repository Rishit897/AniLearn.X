'use strict';

const { createClient } = require('@supabase/supabase-js');

let supabaseAdmin = null;
function getAdmin() {
  if (!supabaseAdmin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || url.includes('YOUR_') || key.includes('YOUR_')) {
      throw new Error('Supabase server credentials are not configured.');
    }
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return supabaseAdmin;
}

function getAccessToken(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  const cookies = (req.headers.cookie || '').split(';').map(c => c.trim());
  const access = cookies.find(c => c.startsWith('anilearn_access_token='));
  return access ? access.split('=').slice(1).join('=') : null;
}

async function authenticate(req, res, next) {
  const token = getAccessToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  try {
    const { data, error } = await getAdmin().auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }
    const u = data.user;
    req.user = { id: u.id, email: u.email, aud: u.aud, role: u.role };
    req.accessToken = token;
    return next();
  } catch (err) {
    console.error('[auth] verification error:', err.message);
    return res.status(500).json({ error: 'Authentication service error.' });
  }
}

module.exports = { authenticate };
