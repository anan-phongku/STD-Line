-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security, then allow full read/write for now since this is
-- an internal tool with no login. Once you add Supabase Auth, replace the
-- policy below with something scoped to authenticated users.
alter table kv_store enable row level security;

drop policy if exists "Allow all access" on kv_store;
create policy "Allow all access"
  on kv_store
  for all
  using (true)
  with check (true);

-- Optional: a storage bucket for photos uploaded after go-live (camera capture,
-- "+ เพิ่มรูปจากเครื่อง", drag-and-drop uploads). The seed data ships as base64
-- inside payload.json, so this bucket is only needed for NEW images added after
-- deploy. Create it from the dashboard (Storage → New bucket → name:
-- "station-photos" → Public bucket: on) or run:
--
-- insert into storage.buckets (id, name, public) values ('station-photos', 'station-photos', true);
