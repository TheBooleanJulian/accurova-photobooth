-- Session metadata for Accurova Photobooth.
-- Mirrors the SQLite schema in services/api/app/sessions.py. The API does not
-- use Supabase yet; apply this once a project exists and the Supabase adapter
-- is written (M6). No personal data is stored: no names, contacts or device ids.

create table if not exists public.sessions (
    id            uuid primary key default gen_random_uuid(),
    template_id   text not null,
    status        text not null default 'active'
                  check (status in ('active', 'delivered', 'complete')),
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    completed_at  timestamptz,
    result_key    text,
    result_width  integer,
    result_height integer,
    token_hash    text unique          -- sha-256 of the download token; the token itself is never stored
);

create index if not exists sessions_expires_at on public.sessions (expires_at);

-- Only the API (service role) may touch this table. With row level security
-- enabled and no policies, the anon and authenticated roles get nothing.
alter table public.sessions enable row level security;
revoke all on public.sessions from anon, authenticated;
