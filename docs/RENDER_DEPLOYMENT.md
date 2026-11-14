# AniLearn.X — Deployment Guide

## Services
1. Web: `cd backend && npm install` then `cd backend && npm start`
2. Worker: `cd backend && npm install` then `cd backend && npm run worker`

## Requirements
- Node.js >= 18, npm, ffmpeg/ffprobe
- Supabase (PostgreSQL/Auth/Storage): run `backend/database/migrations/001_initial.sql`, create private buckets, enable email magic link/OTP
- Ollama (local open-source model) for ANI/scripts
- Piper TTS HTTP service for narration (`POST /synthesize` -> WAV)
- Open-source/self-hosted image/video generation endpoints as configured
- Optional: Resend API key for email notifications

## Environment
Use `backend/.env.example` (no secrets in frontend/repo): Supabase keys, `PUBLIC_BASE_URL`, `CORS_ORIGIN`, Ollama, Piper, image/video engine, Resend, storage buckets, FFmpeg, security/worker settings.

## Restrictions
- No Google Cloud, no Meta/WhatsApp, no payment gateways, no unapproved paid APIs/subscriptions.

## Verify before claiming ready
- `/health`, auth flows, RLS/user isolation, project CRUD, eligibility/cooldown/concurrency, real media generation (Piper WAV, clips, FFmpeg output), storage playback, notifications, and E2E pipeline.
