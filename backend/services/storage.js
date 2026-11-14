'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseAdmin = null;
function getAdmin() {
  if (!supabaseAdmin) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase service-role credentials are not configured on the backend.');
    }
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return supabaseAdmin;
}

const BUCKET_VIDEOS   = process.env.SUPABASE_STORAGE_BUCKET_VIDEOS   || 'anilearn-videos';
const BUCKET_IMAGES   = process.env.SUPABASE_STORAGE_BUCKET_IMAGES   || 'anilearn-images';
const BUCKET_THUMBS   = process.env.SUPABASE_STORAGE_BUCKET_THUMBNAILS || 'anilearn-thumbnails';

class NotConfiguredError extends Error {
  constructor(msg) { super(msg); this.name = 'NotConfiguredError'; }
}

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new NotConfiguredError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.');
  }
  return getAdmin();
}

async function uploadBuffer(bucket, filePath, buffer, contentType) {
  const sb = requireSupabase();
  const { data, error } = await sb.storage.from(bucket).upload(filePath, buffer, {
    contentType, cacheControl: '3600', upsert: false
  });
  if (error) throw error;
  return { path: data.path, fullPath: data.fullPath };
}

async function downloadBuffer(bucket, filePath) {
  const sb = requireSupabase();
  const { data, error } = await sb.storage.from(bucket).download(filePath);
  if (error) throw error;
  return data;
}

async function createSignedUrl(bucket, filePath, expiresIn = 3600) {
  const sb = requireSupabase();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(filePath, expiresIn);
  if (error) throw error;
  return { signedUrl: data.signedUrl };
}

async function removeFile(bucket, filePath) {
  const sb = requireSupabase();
  const { error } = await sb.storage.from(bucket).remove([filePath]);
  if (error) throw error;
  return true;
}

async function ensureBuckets() {
  const sb = requireSupabase();
  const buckets = [BUCKET_VIDEOS, BUCKET_IMAGES, BUCKET_THUMBS];
  for (const bucket of buckets) {
    try {
      const { error } = await sb.storage.createBucket(bucket, { public: false });
      if (error && !error.message.includes('already exists') && !error.message.includes('409')) {
        console.warn(`[storage] bucket ${bucket}:`, error.message);
      } else {
        console.log(`[storage] bucket ready: ${bucket}`);
      }
    } catch (err) {
      console.warn(`[storage] bucket check skipped ${bucket}:`, err.message);
    }
  }
}

module.exports = { getAdmin, requireSupabase, uploadBuffer, downloadBuffer, createSignedUrl, removeFile, ensureBuckets, BUCKET_VIDEOS, BUCKET_IMAGES, BUCKET_THUMBS, NotConfiguredError };
