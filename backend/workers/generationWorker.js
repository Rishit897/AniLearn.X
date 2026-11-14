'use strict';

/**
 * AniLearn.X background generation worker.
 *
 * Polls Supabase for generation_jobs with status='processing' and current_stage='starting',
 * claims each job atomically, then runs the real end-to-end pipeline:
 *
 *   1. AI educational script (Ollama / open-source LLM)
 *   2. Anime scene images (image provider)
 *   3. Video clips (modular VideoEngine -> Kaggle GPU open-weight model)
 *   4. Narration (Piper TTS -> WAV)
 *   5. Subtitles (WebVTT)
 *   6. FFmpeg assembly (clips + narration + subtitles + optional BGM)
 *   7. Upload video + thumbnail to Supabase Storage
 *   8. Verify duration & integrity
 *   9. complete_generation_job()  -> starts the 30-minute cooldown
 *  10. Send completion notification(s)
 *
 * On any failure: fail_generation_job() -> no cooldown, slot released, user can retry.
 *
 * Run:  node workers/generationWorker.js
 * Deploy on Render as a background worker service.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const { generateText, buildScriptPrompt } = require('../services/llm');
const { generateImage } = require('../services/imageGeneration');
const { getVideoEngine, CLIPS_PER_DURATION, NotConfiguredError: VENotConfigured } = require('../services/videoEngine');
const { synthesize } = require('../services/tts');
const { generateVTT, buildSubtitlesFromScenes } = require('../services/subtitles');
const { assembleVideo, probeDuration } = require('../services/videoAssembly');
const {
  uploadBuffer, createSignedUrl, removeFile, BUCKET_VIDEOS, BUCKET_IMAGES, BUCKET_THUMBS,
  requireSupabase, NotConfiguredError
} = require('../services/storage');
const { sendCompletionNotification } = require('../services/notifications');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);
const MAX_VIDEO_POLLS = parseInt(process.env.VIDEO_MAX_POLLS || '60', 10);
const VIDEO_POLL_INTERVAL_MS = parseInt(process.env.VIDEO_POLL_INTERVAL_MS || '10000', 10);

let supabaseAdmin = null;
function getAdmin() {
  if (!supabaseAdmin) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_URL.includes('YOUR_') || SUPABASE_SERVICE_ROLE_KEY.includes('YOUR_')) {
      throw new Error('Supabase service-role credentials are not configured for the worker.');
    }
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return supabaseAdmin;
}

const TMP_DIR = path.join(os.tmpdir(), 'anilearn-worker');
fs.mkdirSync(TMP_DIR, { recursive: true });

let running = true;
process.on('SIGTERM', () => { running = false; console.log('[worker] SIGTERM received, stopping after current job.'); });
process.on('SIGINT', () => { running = false; console.log('[worker] SIGINT received, stopping after current job.'); });

function log(...args) { console.log(`[worker ${new Date().toISOString()}]`, ...args); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return destPath;
}

function targetMinutes(duration) { return { short: 5, medium: 7, long: 10 }[duration] || 5; }

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Claim the next due job: atomically transition one 'starting' job to 'scripting'. */
async function claimNextJob() {
  const sb = getAdmin();
  const { data, error } = await sb
    .from('generation_jobs')
    .update({ current_stage: 'scripting' })
    .eq('status', 'processing')
    .eq('current_stage', 'starting')
    .order('started_at', { ascending: true })
    .limit(1)
    .select('*, projects(*), video_quotas(*)')
    .single();
  if (error) return null;
  return data || null;
}

async function updateJob(jobId, updates) {
  const sb = getAdmin();
  const { error } = await sb.from('generation_jobs').update(updates).eq('id', jobId);
  if (error) throw error;
}

async function updateProject(projectId, updates) {
  const sb = getAdmin();
  const { error } = await sb.from('projects').update(updates).eq('id', projectId);
  if (error) throw error;
}

async function stepScripting(job, project) {
  await updateJob(job.id, { current_stage: 'scripting' });
  log(`Job ${job.id}: generating script with LLM (${project.title})`);

  const inputs = {
    topic: project.topic, sourceText: project.script || '', subject: project.subject,
    classLevel: project.class, duration: project.selected_duration,
    narrationLanguage: project.language || 'en', animeStyle: project.anime_style || 'Battle Academy',
    difficulty: 'intermediate', creativity: 7, drama: 5, features: {}
  };
  const prompt = buildScriptPrompt(inputs);
  const raw = await generateText(prompt, {
    systemInstruction: 'You are an expert educational anime scriptwriter. Return ONLY valid JSON, no markdown fences.',
    temperature: 0.7, maxOutputTokens: 4096
  });

  let scriptJson;
  try { scriptJson = JSON.parse(raw); } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    scriptJson = match ? JSON.parse(match[0]) : null;
  }
  if (!scriptJson || !scriptJson.scenes || !Array.isArray(scriptJson.scenes)) {
    throw new Error('LLM did not return a valid script with scenes.');
  }

  await updateProject(project.id, { script: JSON.stringify(scriptJson), title: scriptJson.title || project.title, status: 'processing' });
  return scriptJson;
}

async function stepImages(scenes, job, project) {
  await updateJob(job.id, { current_stage: 'image_generation' });
  const imageUrls = [];
  for (const scene of scenes) {
    log(`Job ${job.id}: generating image for scene ${scene.scene}`);
    const result = await generateImage(scene.visualPrompt || scene.title);
    const fileName = `scenes/job_${job.id}/scene_${String(scene.scene).padStart(3, '0')}.png`;
    await uploadBuffer(BUCKET_IMAGES, fileName, result.imageBuffer, result.contentType);
    const { signedUrl } = await createSignedUrl(BUCKET_IMAGES, fileName, 3600);
    imageUrls.push({ scene: scene.scene, url: signedUrl, path: fileName });
  }
  return imageUrls;
}

async function stepVideoClips(scenes, job, project) {
  await updateJob(job.id, { current_stage: 'video_generation' });
  let videoEngine;
  try { videoEngine = getVideoEngine(); } catch (err) {
    throw new Error(`Video engine not configured: ${err.message}. Set VIDEO_ENGINE=kaggle and configure KAGGLE_VIDEO_API_URL/KAGGLE_VIDEO_API_KEY.`);
  }
  const caps = videoEngine.getCapabilities ? videoEngine.getCapabilities() : {};
  log(`Job ${job.id}: video engine = ${caps.engine || 'unknown'}, model = ${process.env.VIDEO_MODEL || caps.model}`);

  const clipDir = path.join(TMP_DIR, `job_${job.id}`);
  fs.mkdirSync(clipDir, { recursive: true });

  const clips = [];
  const targetMin = targetMinutes(project.selected_duration);
  const secondsPerClip = Math.max(4, Math.round((targetMin * 60) / scenes.length));

  for (const scene of scenes) {
    const prompt = `${scene.visualPrompt || scene.title}. Anime educational scene, 16:9, high quality.`;
    log(`Job ${job.id}: submitting clip for scene ${scene.scene} to ${caps.engine || 'video engine'}`);
    const submitted = await videoEngine.generateClip(prompt, { durationSeconds: secondsPerClip, aspectRatio: '16:9' });

    let videoUrl = null;
    let status = 'processing';
    for (let i = 0; i < MAX_VIDEO_POLLS; i++) {
      await sleep(VIDEO_POLL_INTERVAL_MS);
      const checked = await videoEngine.getJobStatus(submitted.jobId);
      status = checked.status;
      if (checked.status === 'succeeded') { videoUrl = checked.videoUrl; break; }
      if (checked.status === 'failed') {
        throw new Error(`Video generation failed for scene ${scene.scene}: ${checked.error || 'provider error'}.`);
      }
    }
    if (status !== 'succeeded' || !videoUrl) {
      throw new Error(`Video generation did not complete for scene ${scene.scene} (last status: ${status}).`);
    }

    const clipPath = path.join(clipDir, `scene_${String(scene.scene).padStart(3, '0')}.mp4`);
    await downloadToFile(videoUrl, clipPath);
    clips.push({ scene: scene.scene, path: clipPath });
  }
  return clips;
}

async function stepNarration(scriptJson, job, project) {
  await updateJob(job.id, { current_stage: 'narration' });
  const text = scriptJson.explanation || scriptJson.narration || scriptJson.title || project.topic || '';
  const language = (project.language || project.narration_language || 'en').toLowerCase();
  // Piper voices are model names (e.g. en_US-lessac-medium.onnx). Configure via PIPER_VOICE or per-language map.
  const voiceMap = {
    en: process.env.PIPER_VOICE_EN || process.env.PIPER_VOICE || undefined,
    hi: process.env.PIPER_VOICE_HI || process.env.PIPER_VOICE || undefined,
    ja: process.env.PIPER_VOICE_JA || process.env.PIPER_VOICE || undefined
  };
  const voice = voiceMap[language] || voiceMap.en || process.env.PIPER_VOICE || undefined;
  const speakingRate = Number(process.env.TTS_SPEAKING_RATE || 1.0) || 1.0;

  // Provider writes a WAV file into the job temp dir and returns its path for FFmpeg assembly.
  const result = await synthesize(text, {
    voice,
    speed: speakingRate,
    outputDir: path.join(TMP_DIR, `job_${job.id}`),
    timeoutMs: parseInt(process.env.TTS_TIMEOUT_MS || '120000', 10)
  });

  if (!result || !result.audioPath || !fs.existsSync(result.audioPath)) {
    throw new Error('TTS synthesis did not produce an audio file.');
  }
  const stat = fs.statSync(result.audioPath);
  if (!stat.size) throw new Error('TTS synthesis produced an empty audio file.');

  log(`Job ${job.id}: narration synthesized via ${result.provider} (${stat.size} bytes, ${result.audioPath})`);
  return result.audioPath;
}

async function stepSubtitles(scriptJson, job) {
  await updateJob(job.id, { current_stage: 'subtitles' });
  const entries = buildSubtitlesFromScenes(scriptJson.scenes || [], { language: 'en' });
  const vtt = generateVTT(entries);
  const vttPath = path.join(TMP_DIR, `job_${job.id}_subtitles.vtt`);
  fs.writeFileSync(vttPath, vtt);
  return vttPath;
}

async function stepAssembly(clips, narrationPath, vttPath, job, project) {
  await updateJob(job.id, { current_stage: 'assembly' });
  const targetMin = targetMinutes(project.selected_duration);
  const outputPath = path.join(TMP_DIR, `job_${job.id}_final.mp4`);
  const result = await assembleVideo({
    clips: clips.map(c => ({ path: c.path })), narrationPath, subtitlesPath: vttPath,
    bgmPath: undefined, outputPath, targetDurationSeconds: targetMin * 60
  });

  await updateJob(job.id, { current_stage: 'upload' });
  const videoBuf = fs.readFileSync(result.outputPath);
  const videoFileName = `videos/user_${job.user_id}/project_${project.id}_final.mp4`;
  await uploadBuffer(BUCKET_VIDEOS, videoFileName, videoBuf, 'video/mp4');

  await updateJob(job.id, { current_stage: 'verification' });
  const thumbPath = path.join(TMP_DIR, `job_${job.id}_thumb.jpg`);
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg';
    const at = Math.max(1, Math.round(result.actualDurationSeconds * 0.1));
    await execFileAsync(ffmpegBin, ['-y', '-ss', String(at), '-i', result.outputPath, '-frames:v', '1', thumbPath]);
    const thumbBuf = fs.readFileSync(thumbPath);
    const thumbFileName = `thumbnails/user_${job.user_id}/project_${project.id}_thumb.jpg`;
    await uploadBuffer(BUCKET_THUMBS, thumbFileName, thumbBuf, 'image/jpeg');
    const { signedUrl: thumbUrl } = await createSignedUrl(BUCKET_THUMBS, thumbFileName, 3600);
    await updateProject(project.id, { thumbnail_path: thumbFileName, thumbnail_url: thumbUrl });
  } catch (err) { log(`Job ${job.id}: thumbnail extraction skipped:`, err.message); }

  const { signedUrl: videoSignedUrl } = await createSignedUrl(BUCKET_VIDEOS, videoFileName, 3600);

  await updateProject(project.id, {
    video_path: videoFileName, video_url: videoSignedUrl,
    actual_duration_seconds: Math.round(result.actualDurationSeconds),
    actual_duration_text: formatDuration(result.actualDurationSeconds),
    status: 'completed'
  });

  return { videoFileName, videoSignedUrl, actualDurationSeconds: result.actualDurationSeconds };
}

async function sendNotifications(job, project, videoUrl) {
  const sb = getAdmin();
  const { data: prefs } = await sb.from('notification_preferences').select('*').eq('user_id', job.user_id).single();
  if (!prefs || prefs.method === 'dashboard') return { results: [] };

  const { data: profile } = await sb.from('user_profiles').select('display_name, email').eq('id', job.user_id).single();
  const userName = (profile && profile.display_name) || 'there';
  const toEmail = profile && profile.email;

  return await sendCompletionNotification({
    userId: job.user_id, method: prefs.method, toEmail,
    projectTitle: project.title, videoUrl, userName
  });
}

async function processJob(rawJob) {
  const job = rawJob;
  const project = rawJob.projects || {};
  const userId = job.user_id;
  const started = Date.now();

  try {
    log(`Processing job ${job.id} for user ${userId}: ${project.title || '(untitled)'}`);

    const scriptJson = await stepScripting(job, project);
    const scenes = scriptJson.scenes || [];

    let imageUrls = [];
    try { imageUrls = await stepImages(scenes, job, project); } catch (err) {
      log(`Job ${job.id}: image generation skipped/failed:`, err.message);
    }

    const clips = await stepVideoClips(scenes, job, project);

    let narrationPath = null;
    try { narrationPath = await stepNarration(scriptJson, job, project); } catch (err) {
      log(`Job ${job.id}: TTS skipped:`, err.message);
    }

    let vttPath = null;
    try { vttPath = await stepSubtitles(scriptJson, job, project); } catch (err) {
      log(`Job ${job.id}: subtitle generation skipped:`, err.message);
    }

    const assembly = await stepAssembly(clips, narrationPath, vttPath, job, project);

    const sb = getAdmin();
    await sb.rpc('complete_generation_job', {
      p_job_id: job.id, p_project_id: project.id, p_video_path: assembly.videoFileName,
      p_actual_duration_seconds: Math.round(assembly.actualDurationSeconds),
      p_actual_duration_text: formatDuration(assembly.actualDurationSeconds)
    });

    try {
      const notif = await sendNotifications(job, project, assembly.videoSignedUrl);
      log(`Job ${job.id}: notifications:`, JSON.stringify(notif.results.map(r => ({ ch: r.channel, ok: r.ok }))));
    } catch (err) { log(`Job ${job.id}: notification error (non-fatal):`, err.message); }

    await updateJob(job.id, { status: 'completed', current_stage: 'done', completed_at: new Date().toISOString() });

    log(`Job ${job.id}: COMPLETED in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    log(`Job ${job.id}: FAILED —`, err.message);
    try {
      const sb = getAdmin();
      await sb.rpc('fail_generation_job', { p_job_id: job.id, p_failure_details: err.message });
      await updateJob(job.id, { status: 'failed', current_stage: 'failed', completed_at: new Date().toISOString() });
      await updateProject(project.id || job.project_id, { status: 'failed' });
    } catch (e2) { log(`Job ${job.id}: could not record failure:`, e2.message); }
  } finally {
    try {
      const jobDir = path.join(TMP_DIR, `job_${job.id}`);
      if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
      for (const f of fs.readdirSync(TMP_DIR)) {
        if (f.startsWith(`job_${job.id}_`)) { try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch { /* ignore */ } }
      }
    } catch { /* ignore */ }
  }
}

async function loop() {
  log('AniLearn.X generation worker started.');
  log('Poll interval:', POLL_INTERVAL_MS, 'ms');

  while (running) {
    try {
      const job = await claimNextJob();
      if (job) await processJob(job);
    } catch (err) { log('Worker loop error:', err.message); }
    if (running) await sleep(POLL_INTERVAL_MS);
  }

  log('AniLearn.X generation worker stopped.');
}

(async () => {
  try {
    const sb = getAdmin();
    await sb.from('generation_jobs').select('id').limit(1);
    log('Supabase connectivity OK.');
  } catch (err) {
    log('WARNING: Supabase connectivity check failed:', err.message);
    log('Worker will still start; jobs will fail until credentials are configured.');
  }
  loop();
})();
