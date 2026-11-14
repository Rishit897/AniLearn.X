-- ============================================================================
-- AniLearn.X — Supabase PostgreSQL migration (001_initial.sql)
-- Apply via Supabase SQL Editor or CLI (supabase db push).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists user_profiles (
  id              uuid references auth.users not null primary key,
  display_name    text,
  email           text,
  avatar_url      text,
  default_language       text        default 'en',
  default_class          text,
  default_subject        text,
  default_anime_style    text,
  default_duration       text        default 'short',
  default_narration_language text  default 'en',
  default_subtitle_language  text default 'en',
  created_at      timestamptz       default now(),
  updated_at      timestamptz       default now()
);

create table if not exists projects (
  id                   uuid default gen_random_uuid() primary key,
  user_id              uuid references auth.users not null,
  title                text not null,
  subject              text,
  class                text,
  topic                text,
  script               text,
  selected_duration    text,
  actual_duration_seconds integer,
  actual_duration_text text,
  video_path           text,
  video_url            text,
  thumbnail_path       text,
  thumbnail_url        text,
  language             text,
  anime_style          text,
  status               text default 'pending',
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create table if not exists generation_jobs (
  id                uuid default gen_random_uuid() primary key,
  user_id           uuid references auth.users not null,
  project_id        uuid references projects(id) on delete set null,
  status            text default 'pending',
  current_stage     text,
  started_at        timestamptz,
  completed_at      timestamptz,
  failure_details   text,
  provider_job_ref  text,
  created_at        timestamptz default now()
);

create table if not exists video_quotas (
  user_id                       uuid references auth.users primary key,
  active_job_id                 uuid references generation_jobs(id),
  generation_status             text default 'idle',
  generation_started_at         timestamptz,
  generation_completed_at       timestamptz,
  next_generation_allowed_at    timestamptz,
  updated_at                    timestamptz default now()
);

create table if not exists notification_preferences (
  user_id                 uuid references auth.users primary key,
  method                  text default 'dashboard',
  whatsapp_phone          text,
  whatsapp_consent        boolean default false,
  whatsapp_consent_at     timestamptz,
  email                   boolean default false,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create table if not exists notification_logs (
  id                uuid default gen_random_uuid() primary key,
  user_id           uuid references auth.users not null,
  project_id        uuid references projects(id) on delete set null,
  channel           text,
  status            text,
  provider_response jsonb,
  created_at        timestamptz default now()
);

create table if not exists legal_acceptances (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users not null,
  terms_version  text,
  privacy_version text,
  accepted_at    timestamptz default now(),
  age_verified   boolean default false,
  parental_consent boolean default false
);

create table if not exists chat_conversations (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users not null,
  title       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists chat_messages (
  id             uuid default gen_random_uuid() primary key,
  conversation_id uuid references chat_conversations(id) on delete cascade,
  user_id        uuid references auth.users not null,
  role           text,
  content        text,
  created_at     timestamptz default now()
);

create index if not exists idx_projects_user_id on projects(user_id);
create index if not exists idx_projects_status on projects(status);
create index if not exists idx_generation_jobs_user_id on generation_jobs(user_id);
create index if not exists idx_video_quotas_next_allowed on video_quotas(next_generation_allowed_at);
create index if not exists idx_chat_messages_conversation on chat_messages(conversation_id);

alter table user_profiles       enable row level security;
alter table projects            enable row level security;
alter table generation_jobs     enable row level security;
alter table video_quotas        enable row level security;
alter table notification_preferences enable row level security;
alter table notification_logs   enable row level security;
alter table legal_acceptances   enable row level security;
alter table chat_conversations  enable row level security;
alter table chat_messages       enable row level security;

create policy "user_profiles own access" on user_profiles for all using (auth.uid() = id);
create policy "projects own access" on projects for all using (auth.uid() = user_id);
create policy "generation_jobs own access" on generation_jobs for all using (auth.uid() = user_id);
create policy "video_quotas own access" on video_quotas for all using (auth.uid() = user_id);
create policy "notification_preferences own access" on notification_preferences for all using (auth.uid() = user_id);
create policy "notification_logs own access" on notification_logs for all using (auth.uid() = user_id);
create policy "legal_acceptances own access" on legal_acceptances for all using (auth.uid() = user_id);
create policy "chat_conversations own access" on chat_conversations for all using (auth.uid() = user_id);
create policy "chat_messages own access" on chat_messages for all using (auth.uid() = user_id);

-- Atomic eligibility check
create or replace function check_generation_eligibility(p_user_id uuid)
returns table (eligible boolean, job_id uuid, message text)
language plpgsql as $$
declare
  v_active uuid;
  v_allowed timestamptz;
  v_now timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('anilearn:generation:' || p_user_id));
  select active_job_id, next_generation_allowed_at
    into v_active, v_allowed
    from video_quotas
   where user_id = p_user_id
   for update;

  if v_active is not null then
    if exists (select 1 from generation_jobs where id = v_active and status in ('pending','processing')) then
      return query select false, v_active, 'A video is already being generated. Please wait until it finishes.';
    end if;
    update video_quotas set active_job_id = null, generation_status = 'idle', updated_at = now() where user_id = p_user_id;
    v_active := null;
  end if;

  if v_allowed is not null and v_allowed > v_now then
    return query select false, null, 'Cooldown active. Next video available at ' || to_char(v_allowed, 'HH24:MI:SS') || '.';
  end if;

  return query select true, null, 'Eligible to generate.';
end;
$$;

-- Atomically claim slot + create job
create or replace function claim_generation_slot(p_user_id uuid, p_project_id uuid)
returns table (ok boolean, job_id uuid, message text)
language plpgsql as $$
declare
  v_now timestamptz := now();
  v_job uuid;
begin
  perform pg_advisory_xact_lock(hashtext('anilearn:generation:' || p_user_id));

  declare
    v_active uuid;
    v_allowed timestamptz;
  begin
    select active_job_id, next_generation_allowed_at
      into v_active, v_allowed
      from video_quotas
     where user_id = p_user_id
     for update;

    if v_active is not null and exists (select 1 from generation_jobs where id = v_active and status in ('pending','processing')) then
      return query select false, null, 'A video is already being generated.';
    end if;
    if v_allowed is not null and v_allowed > v_now then
      return query select false, null, 'Post-completion cooldown is active until ' || to_char(v_allowed, 'HH24:MI:SS') || '.';
    end if;
  end;

  insert into generation_jobs (user_id, project_id, status, current_stage, started_at)
  values (p_user_id, p_project_id, 'pending', 'queued', v_now) returning id into v_job;

  insert into video_quotas (user_id, active_job_id, generation_status, generation_started_at, updated_at)
  values (p_user_id, v_job, 'generating', v_now, v_now)
  on conflict (user_id) do update
    set active_job_id = v_job, generation_status = 'generating', generation_started_at = v_now, updated_at = v_now;

  return query select true, v_job, 'Generation job created.';
end;
$$;

-- Complete job -> start 30-min cooldown
create or replace function complete_generation_job(
  p_job_id uuid, p_project_id uuid, p_video_path text,
  p_actual_duration_seconds integer, p_actual_duration_text text
) returns void language plpgsql as $$
declare
  v_user_id uuid;
  v_now timestamptz := now();
begin
  select user_id into v_user_id from generation_jobs where id = p_job_id;

  update generation_jobs set status='completed', completed_at=v_now, current_stage='done' where id=p_job_id;
  update projects set status='completed', video_path=p_video_path, actual_duration_seconds=p_actual_duration_seconds,
         actual_duration_text=p_actual_duration_text, updated_at=v_now where id=p_project_id;
  update video_quotas set active_job_id=null, generation_status='cooling_down',
         generation_completed_at=v_now, next_generation_allowed_at=v_now + interval '30 minutes', updated_at=v_now
   where user_id=v_user_id;
end;
$$;

-- Fail job -> release slot, no cooldown
create or replace function fail_generation_job(p_job_id uuid, p_failure_details text)
returns void language plpgsql as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from generation_jobs where id = p_job_id;
  update generation_jobs set status='failed', completed_at=now(), failure_details=p_failure_details, current_stage='failed' where id=p_job_id;
  update video_quotas set active_job_id=null, generation_status='idle', updated_at=now() where user_id=v_user_id;
end;
$$;
