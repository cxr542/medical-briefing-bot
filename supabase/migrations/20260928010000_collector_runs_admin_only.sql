begin;

drop policy if exists "collector runs are readable" on public.collector_runs;
drop policy if exists "collector service can read runs" on public.collector_runs;
create policy "collector service can read runs"
  on public.collector_runs
  for select
  to service_role
  using (true);

revoke select on table public.collector_runs from public, anon, authenticated;
grant select, insert on table public.collector_runs to service_role;

commit;
