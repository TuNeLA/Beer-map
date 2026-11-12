-- 0505 · PUSH_DEVICE (a4rel, 12 Nov 2026). OWNER-RUN. Additive. Safe to run many times.
-- Why (I-19a): one phone can have two push rows for one user: one from a browser tab (Samsung Browser) and one from the
-- installed app. Both got every push. Now the app tells the server what kind of device a row is (dev) and whether it is the
-- installed app (standalone). The edge function notify-group then sends ONE push per user+device class
-- (installed app wins, else the newest row). Old rows (dev null) are treated as before. No data is removed.
alter table public.push_subscriptions add column if not exists dev text;
alter table public.push_subscriptions add column if not exists standalone boolean;
alter table public.push_subscriptions add column if not exists seen_at timestamptz;

create or replace function public.set_push_device(p_endpoint text, p_dev text, p_standalone boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.push_subscriptions
     set dev = case when p_dev in ('android', 'ios', 'desktop') then p_dev else null end,
         standalone = coalesce(p_standalone, false),
         seen_at = now()
   where endpoint = p_endpoint and user_id = public.olnu_uid();
end;
$$;

revoke all on function public.set_push_device(text, text, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.set_push_device(text, text, boolean) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.set_push_device(text, text, boolean) to authenticated';
  end if;
end $$;

select public.olnu_strip_cr();
