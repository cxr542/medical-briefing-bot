create table if not exists public.collector_alert_state (
  singleton_id boolean primary key default true check (singleton_id is true),
  state jsonb not null default '{"version":1,"activeIncidents":{},"events":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.collector_alert_state enable row level security;

revoke all on table public.collector_alert_state from public, anon, authenticated;
grant select, insert, update on table public.collector_alert_state to service_role;

drop policy if exists "collector alert state service access" on public.collector_alert_state;
create policy "collector alert state service access"
  on public.collector_alert_state
  for all
  to service_role
  using (true)
  with check (true);

insert into public.collector_alert_state (singleton_id)
values (true)
on conflict (singleton_id) do nothing;
