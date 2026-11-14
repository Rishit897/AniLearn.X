// ── AniLearn.X entry point ───────────────────────────────────────────────
// Serves the modular backend (backend/server.js) which mounts the API,
// the frontend SPA (index.html at project root), and the health endpoint.
//
// The long-running generation worker is a separate process:
//   node backend/workers/generationWorker.js
// (deployed on Render as a background worker service).

require('./backend/server.js');
