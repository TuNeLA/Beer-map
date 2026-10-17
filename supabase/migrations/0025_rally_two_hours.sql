-- 0025 Call-outs (rallies) end 2 hours after they were made (or at 05:00 if that is earlier).
-- Readers already filter on expires_at > now() (olnu_rally_rows, poll_v2, answer_rally).
create or replace function public.olnu_rally_short_life()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.expires_at := least(coalesce(new.expires_at, now() + interval '2 hours'), coalesce(new.created_at, now()) + interval '2 hours');
  return new;
end;
$$;
revoke all on function public.olnu_rally_short_life() from public, anon, authenticated;
create trigger rallies_short_life before insert on public.rallies
  for each row execute function public.olnu_rally_short_life();
update public.rallies set expires_at = least(expires_at, created_at + interval '2 hours')
 where expires_at > now();
