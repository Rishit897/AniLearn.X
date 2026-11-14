# AniLearn.X — Testing Report (Honest)

**Environment:** Windows, workspace `C:\Users\Dell\AniLearnX`. Node.js/npm not available on PATH in this execution environment (`node` command not found). No external service credentials configured (Supabase, Gemini, Kaggle GPU, Piper TTS, image, WhatsApp, email). ffmpeg not verified.

## What was inspected

- Original `AniLearnX` (root): `index.html` (1716 lines, single-file UI with simulated SSO, fake Teleportation Matrix logs, localStorage password storage, hardcoded scenes/history), `server.js` (simulation-mode Express API), `package.json`, `.env.example`, `.gitignore`, `smoke-test.js`.
- `AniLearnX-backend`: older simplified backend variant.
- `AniLearnX2`: minimal placeholder.
- Backup created at `C:\Users\Dell\AniLearnX.original-backup`.

## What was implemented

### Backend (real architecture)
- `backend/package.json`, `.env.example`, `.gitignore`, modular `server.js` with Helmet, CORS, rate limits, `/health`, `/api/status`.
- **Database migration** `001_initial.sql`: tables `user_profiles`, `projects`, `generation_jobs`, `video_quotas`, `notification_preferences`, `notification_logs`, `legal_acceptances`, `chat_conversations`, `chat_messages`; RLS policies (users access only own data); indexes; atomic functions `check_generation_eligibility`, `claim_generation_slot`, `complete_generation_job` (sets 30-min cooldown after success), `fail_generation_job` (no cooldown).
- **Middleware:** auth (Supabase JWT from cookie/header), validation, rate limiting.
- **Services:** storage (Supabase Storage, signed URLs), gemini (real Generative Language API), imageGeneration (OpenAI/Stability), modular `videoEngine` + `kaggleVideoEngine` (Kaggle notebook HTTP API for open-weight models, NOT Google Flow), tts (Piper TTS local HTTP service, WAV output), subtitles (WebVTT), videoAssembly (FFmpeg concat + mix + probe), notifications (Meta WhatsApp Cloud API, Resend/SendGrid).
- **Routes:** auth (Google OAuth redirect via Supabase, email magic-link/OTP, session cookies, logout, account delete, legal acceptance), chat (ANI with Gemini + DB persistence), projects (list/get/delete, signed video URLs), generation (eligibility, quota, atomic start, status), notifications (preferences/logs), settings.
- **Worker:** `backend/workers/generationWorker.js` — polls/claims jobs atomically, runs pipeline (Gemini script → images → video clips via VideoEngine → Piper narration (WAV) → subtitles → FFmpeg assembly → upload to Supabase Storage → verify → `complete_generation_job` → notifications). Failures call `fail_generation_job` (slot released, no cooldown).

### Frontend
- Rewritten `index.html` as a single-page app preserving AniLearn.X identity (re-themed to light commercial: ice blue/lavender/mint/pink, white cards, rounded corners).
- **3 modes:** Create, Review, Settings (top nav, no reload).
- **Real auth:** Google OAuth redirect (`/api/auth/google`) and email magic-link (`/api/auth/email/send`) — no fake account picker, no passwords in localStorage.
- **Create:** topic input, subject/class/language/subtitles, duration (Short 5 / Medium 7 / Long 10 min targets), anime styles, features, "Generate My Anime Video" → eligibility check → `/api/generation/start` → Teleportation Matrix polling `/api/generation/status/:jobId`.
- **Teleportation Matrix:** shows real backend job stages/events (queued, scripting, image_generation, video_generation, narration, subtitles, assembly, upload, verification, done/failed), project/duration/start/elapsed — no fake percentages or invented times.
- **Floating timer:** reads `/api/generation/quota`, shows generating/cooldown countdown (based on `next_generation_allowed_at`) / ready; updates from backend.
- **ANI companion:** floating bottom-left, calls `/api/chat` (Gemini), suggests "Create my video" with confirmation flow.
- **Review:** lists projects from `/api/projects`, play (signed URL), download, details, delete; user-scoped.
- **Settings:** profile/defaults/notifications/legal/logout/delete account via real APIs.
- **Legal:** inline Terms/Privacy text (v1.0).

### Docs
- `README.md`, `docs/KAGGLE_NOTEBOOK_SETUP.md`, `docs/RENDER_DEPLOYMENT.md`, `docs/API.md`, this report.

## Tests run

| Test | Result | Notes |
| --- | --- | --- |
| Syntax check (`node -c` on backend files) | **Not run** | `node` not found in PATH in this environment. |
| `npm install` (backend) | **Not verified** | npm/node not available. |
| Smoke tests (`smoke-test.js`) | **Not run** | Requires Node and running server; original smoke test expects old simulation routes. |
| `/health` endpoint | **Not run** | Server not started (no Node). |
| Google OAuth flow | **Not run** | Requires Supabase project + Google OAuth config + browser. |
| Email magic link/OTP | **Not run** | Requires Supabase + SMTP config. |
| Gemini script/chat | **Not run** | Requires `GEMINI_API_KEY`. |
| Video generation (Kaggle GPU, Wan 2.2) | **Not run** | Requires Kaggle notebook, GPU, model weights, tunnel URL. Milestone (one real clip) not yet proven. |
| FFmpeg assembly | **Not run** | Requires ffmpeg + generated clips. |
| Supabase Storage upload/play | **Not run** | Requires Supabase credentials/buckets. |
| Lock/cooldown (concurrent requests, multi-tab/device, refresh) | **Not run** | Logic implemented in SQL/worker; requires live DB to verify. |
| Failed-job cleanup (no cooldown) | **Not run** | Implemented (`fail_generation_job`); requires live worker test. |
| Review/Settings persistence | **Not run** | Requires live DB + auth. |
| RLS / cross-user isolation | **Not run** | Policies defined in migration; requires Supabase to verify. |
| Notifications (WhatsApp/Email) | **Not run** | Requires provider credentials and approved templates. |

## What cannot be claimed as working

- End-to-end video generation (no GPU/model/runtime verified).
- Any external integration (Gemini, Piper TTS, image gen, WhatsApp, email, Google OAuth, Supabase) without configured credentials/services.
- Actual 5/7/10-minute output durations (depends on model/clip counts/assembly).
- Character consistency across scenes (not tested).
- Production suitability of Kaggle (explicitly not a production server).

## Next steps to make it operational

1. Install Node.js >= 18 and ffmpeg; run `cd backend && npm install`.
2. Create Supabase project, run migration, create storage buckets, configure Google OAuth provider and redirect URL.
3. Set `.env` with real credentials; start web service and worker.
4. Set up Kaggle notebook with a compatible open-weight model, expose `/generate` and `/status`, configure `KAGGLE_VIDEO_API_URL/KEY`.
5. Prove milestone: generate one real anime video clip on Kaggle GPU, then run end-to-end pipeline.
6. Execute the full test plan (auth, lock/cooldown, failure cleanup, cross-user isolation, notifications, deployment).
