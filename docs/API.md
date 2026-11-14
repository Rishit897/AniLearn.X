# AniLearn.X — API Documentation

Base URL: same origin as SPA (e.g. `http://localhost:3000`). Most `/api/*` routes require authentication via HttpOnly session cookie (`anilearn_access_token`) or `Authorization: Bearer <token>`.

## Health
- `GET /health` — backend/env/service status flags (no secrets)
- `GET /api/status` — env/service status map

## Auth (`/api/auth`)
- `GET /me`
- `POST /email/send` — `{ email }` (Supabase magic link/OTP)
- `POST /email/verify` — `{ email, token }`
- `GET /oauth-callback` — exchanges Supabase auth code for session
- `POST /refresh`
- `POST /logout`
- `DELETE /account` (user-scoped)
- `POST /legal-acceptance`

No Google OAuth route. No Meta/WhatsApp auth or APIs.

## Chat / ANI (`/api/chat`)
- `POST /` — `{ message, conversationId? }` (Ollama-backed, server-side)
- `GET /conversations`
- `GET /conversations/:id/messages`

## Projects (`/api/projects`)
- `GET /`
- `GET /:id`
- `DELETE /:id` (user-scoped)

## Generation (`/api/generation`)
- `GET /eligibility`
- `GET /quota`
- `POST /start`
- `GET /status/:jobId` (user-scoped)

Stages: `queued → starting → scripting → image_generation → video_generation → narration → subtitles → assembly → upload → verification → done|failed`.

## Notifications (`/api/notifications`)
- `GET /preferences`
- `POST /preferences` — `{ method: 'email' | 'dashboard' }` (email via Resend when configured). Legacy values are normalized to supported methods.
- `GET /logs`

## Settings (`/api/settings`)
- `GET /`
- `POST /`

## Security notes
- Intended user-scoped access with Supabase RLS + server-side checks; requires live verification.
- HttpOnly session cookies; service-role keys backend-only.
- Rate limiting on auth/general/generation endpoints.
