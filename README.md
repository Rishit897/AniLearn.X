# AniLearn.X — AI-Powered Educational Anime Video Platform

AniLearn.X is a modular, full-stack web application for generating educational anime-style learning videos.

**Status:** In-progress implementation (not launch-ready). Core architecture and modular integrations exist in code, but external services and end-to-end flows are **not fully verified** in this environment. No fake/simulated functionality is claimed as working.

**Policy compliance (code/config/docs):** No Google Cloud, no Meta/WhatsApp API, no payment gateways, and no unapproved paid APIs/subscriptions added. Email notifications use **Resend** (optional). AI scripts/ANI use **Ollama** (local open-source). Narration uses **Piper TTS**. Assembly uses **FFmpeg**. Supabase is used for auth/database/storage. Image/video generation are modular and intended for self-hosted/open-source endpoints.

## Architecture
| Layer | Technology |
| --- | --- |
| Frontend | Single-page app in `index.html` |
| Backend | Node.js + Express (`backend/server.js`) |
| Database/Auth/Storage | Supabase PostgreSQL/Auth/Storage |
| AI scripts / ANI | Ollama via `backend/services/llm.js` |
| TTS | Piper TTS HTTP service via `backend/services/tts.js` (WAV) |
| Subtitles | WebVTT via `backend/services/subtitles.js` |
| Assembly | FFmpeg via `backend/services/videoAssembly.js` |
| Image generation | Self-hosted/open-source HTTP adapter via `backend/services/imageGeneration.js` |
| Video generation | Modular `VideoEngine` + open-weight endpoint adapter (`backend/services/videoEngine.js`, `kaggleVideoEngine.js`) |
| Notifications | Dashboard + Resend email via `backend/services/notifications.js` |
| Worker | `backend/workers/generationWorker.js` |

## Modes
1. **Create** — submit topic/project and start a background generation job (when services configured).
2. **Review** — list/play/download/delete user-owned projects.
3. **Settings** — profile/defaults, email/dashboard notifications, legal, logout, delete account.

ANI companion and timer are floating UI elements.

## Generation controls
- One active generation job per user (atomic DB functions/advisory lock).
- 30-minute cooldown starts only after successful assembly/upload/verification.
- Failed/cancelled jobs release slot with no cooldown.
- Backend/database is source of truth (requires live verification).

## Setup
### Prerequisites
- Node.js >= 18, npm
- ffmpeg/ffprobe
- Supabase project (PostgreSQL, Auth, Storage)
- Ollama + pulled open-source model (e.g. `ollama pull llama3.2:3b`)
- Piper TTS HTTP service (`POST /synthesize` -> WAV)
- Open-source/self-hosted video engine endpoint compatible with VideoEngine contract
- Optional: self-hosted/open-source image endpoint, Resend API key (email)

### Install
```bash
cd backend
npm install
copy .env.example .env
# Edit backend/.env with real values. Never commit .env or expose secrets in frontend.
```

### Supabase
1. Create project and copy `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. Run `backend/database/migrations/001_initial.sql` in Supabase SQL Editor.
3. Create private storage buckets: `anilearn-videos`, `anilearn-images`, `anilearn-thumbnails`.
4. Enable Email auth (magic link/OTP) and configure email delivery/templates/callback as needed.

### Run
```bash
# Terminal 1 - API + SPA
cd backend
npm start

# Terminal 2 - background worker
cd backend
npm run worker
```
Open `http://localhost:3000`. Check `GET /health` and `GET /api/status`.

## Testing & limitations (honest)
- **Not run/verified here:** Node/npm install, syntax/runtime checks, server/worker startup, browser UI/E2E, Supabase auth/DB/storage/RLS, Ollama responses, Piper WAV output, image/video generation, FFmpeg assembly, storage playback, Resend delivery, and full pipeline/cooldown/concurrency tests.
- **Not implemented as complete subsystem:** admin/supervisor dashboard, role management, audit logs, and operational monitoring UI/backend.
- **Depends on external/self-hosted services:** many features will fail or remain unavailable until correctly configured and tested.

## Cost/approval note
No payment gateways or unapproved paid APIs added. Hosting, GPU compute, Resend, or model endpoints may have free-tier limits or costs depending on provider/usage—obtain approval before enabling any paid service.
