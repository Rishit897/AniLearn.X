'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const ENV_CHECKS = [
  { key: 'SUPABASE_URL', sentinel: 'YOUR_PROJECT_ID' },
  { key: 'SUPABASE_ANON_KEY', sentinel: 'YOUR_SUPABASE_ANON_KEY' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', sentinel: 'YOUR_SUPABASE_SERVICE_ROLE_KEY' },
  { key: 'LLM_PROVIDER', sentinel: null },
  { key: 'OLLAMA_URL', sentinel: 'YOUR_' },
  { key: 'VIDEO_ENGINE', sentinel: null },
  { key: 'IMAGE_PROVIDER_URL', sentinel: 'YOUR_' },
  { key: 'PIPER_TTS_URL', sentinel: 'YOUR_' },
  { key: 'EMAIL_PROVIDER_API_KEY', sentinel: 'YOUR_' }
];

const envStatus = {};
ENV_CHECKS.forEach(({ key, sentinel }) => {
  const val = process.env[key];
  const live = sentinel ? (val && !val.includes(sentinel) && val.trim() !== '') : (val && val.trim() !== '');
  envStatus[key] = live ? 'live' : 'not_configured';
  if (!live) console.warn(`[AniLearn.X] ⚠  ${key} not configured — related features disabled until set.`);
});

const { PORT, NODE_ENV, CORS_ORIGIN, PUBLIC_BASE_URL } = process.env;

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const corsOrigin = CORS_ORIGIN || (NODE_ENV === 'production' ? false : '*');
app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'], allowedHeaders: ['Content-Type', 'Authorization'], credentials: true }));

app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/generation', require('./routes/generation'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings', require('./routes/settings));

app.get('/health', (req, res) => {
  const supabaseLive = envStatus['SUPABASE_URL'] === 'live' && envStatus['SUPABASE_SERVICE_ROLE_KEY'] === 'live';
  const llmLive = envStatus['LLM_PROVIDER'] === 'live' && envStatus['OLLAMA_URL'] === 'live';
  res.json({
    status: 'ok', service: 'AniLearn.X Backend', node_env: NODE_ENV || 'development',
    port: PORT || 3000, timestamp: new Date().toISOString(),
    services: { supabase: envStatus['SUPABASE_URL'], llm: envStatus['LLM_PROVIDER'], ollama: envStatus['OLLAMA_URL'], videoEngine: envStatus['VIDEO_ENGINE'], images: envStatus['IMAGE_PROVIDER_URL'], tts: envStatus['PIPER_TTS_URL'], email: envStatus['EMAIL_PROVIDER_API_KEY'] },
    features: { auth: supabaseLive, videoGeneration: envStatus['VIDEO_ENGINE'] === 'live', aiScript: llmLive }
  });
});

app.get('/api/status', (req, res) => {
  res.json({ server: 'running', port: PORT || 3000, node_env: NODE_ENV || 'development', services: envStatus, publicBaseUrl: PUBLIC_BASE_URL || '(not set)' });
});

const FRONTEND_ROOT = path.join(__dirname, '..');
app.get('/', (req, res) => { res.sendFile(path.join(FRONTEND_ROOT, 'index.html')); });
app.get(/^\/(?!api\/).*/, (req, res) => { res.sendFile(path.join(FRONTEND_ROOT, 'index.html')); });

app.use('/api', (req, res) => { res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` }); });

app.use((err, req, res, next) => {
  console.error('[AniLearn.X] Unhandled error:', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error.', ...(NODE_ENV !== 'production' ? { stack: err.stack } : {}) });
});

const PORT_NUM = parseInt(PORT || '3000', 10);
const server = app.listen(PORT_NUM, () => {
  console.log(`[AniLearn.X] Server running on port ${PORT_NUM}`);
  console.log(`[AniLearn.X] Frontend  → http://localhost:${PORT_NUM}/`);
  console.log(`[AniLearn.X] API       → http://localhost:${PORT_NUM}/api/*`);
  console.log(`[AniLearn.X] Health    → http://localhost:${PORT_NUM}/health`);
  console.log(`[AniLearn.X] NODE_ENV  → ${NODE_ENV || 'development'}`);
});

module.exports = { app, server };
