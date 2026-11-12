-- Segmentation jobs. Mirrors the SQLite schema in services/api/app/jobs.py.
-- One job per session; deleting a session removes its job.

create table if not exists public.jobs (
    id          uuid primary key,
    session_id  uuid not null unique references public.sessions (id) on delete cascade,
    status      text not null check (status in ('queued', 'segmenting', 'done', 'failed')),
    error       text,
    attempts    integer not null default 1,
    provider    text,
    width       integer,
    height      integer,
    box_left    integer,
    box_top     integer,
    box_right   integer,
    box_bottom  integer,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;
