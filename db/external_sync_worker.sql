-- Apply after the base FestaMate schema. This migration makes external sync
-- jobs durable and adds storage for the latest daily weather forecast.

-- The base schema used by some Supabase projects does not include the job
-- table. Keep this migration self-contained so the Worker can be enabled on
-- those projects without requiring a table named sync_jobs.
create table if not exists public.external_sync_runs (
    id text primary key default ('job_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
    kind text not null,
    status text not null default 'queued'
        check (status in ('queued', 'running', 'succeeded', 'failed')),
    params jsonb not null default '{}'::jsonb,
    accepted integer not null default 0,
    rejected integer not null default 0,
    rejections jsonb not null default '[]'::jsonb,
    error text,
    requested_by text,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz
);

alter table public.external_sync_runs
    add column if not exists attempts integer not null default 0,
    add column if not exists max_attempts integer not null default 3,
    add column if not exists next_attempt_at timestamptz,
    add column if not exists locked_at timestamptz,
    add column if not exists worker_id text;

update public.external_sync_runs
   set status = 'queued'
 where status is null;

create index if not exists external_sync_runs_queue_idx
    on public.external_sync_runs (status, next_attempt_at, created_at);

create table if not exists public.festival_weather_forecasts (
    festival_id text not null references public.festivals(id) on delete cascade,
    forecast_date date not null,
    precipitation_probability numeric(5, 2) not null check (precipitation_probability between 0 and 100),
    weather_code integer,
    source text not null default 'open-meteo',
    fetched_at timestamptz not null default now(),
    primary key (festival_id, forecast_date)
);

alter table public.festival_weather_forecasts enable row level security;

drop policy if exists weather_forecasts_public_read on public.festival_weather_forecasts;
create policy weather_forecasts_public_read on public.festival_weather_forecasts
    for select using (true);

drop policy if exists weather_forecasts_admin_write on public.festival_weather_forecasts;
create policy weather_forecasts_admin_write on public.festival_weather_forecasts
    for all using (public.is_admin()) with check (public.is_admin());

