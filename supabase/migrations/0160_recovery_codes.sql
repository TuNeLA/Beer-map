-- 0160 Återställningskod: the owner makes a one-time code for a lost account; the user types it in the app
-- ("📥 Jag har en flyttkod" box) on the new account, and everything of the old account moves over.
create table if not exists public.recovery_codes (
  code text primary key,
  old_uid uuid not null,
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid
);
alter table public.recovery_codes enable row level security;

-- Move every public uuid reference old → new. A row that would collide with a unique key stays on the old id.
create or replace function public.olnu_move_user(p_old uuid, p_new uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; k int; x record;
begin
  if p_old is null or p_new is null or p_old = p_new then return 0; end if;
  for r in
    select c.table_name t, c.column_name col
      from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and c.data_type = 'uuid' and c.table_name <> 'recovery_codes'
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', r.t, r.col, r.col) using p_new, p_old;
      get diagnostics k = row_count; n := n + k;
    exception when unique_violation then
      for x in execute format('select ctid from public.%I where %I = $1', r.t, r.col) using p_old loop
        begin
          execute format('update public.%I set %I = $1 where ctid = $2', r.t, r.col) using p_new, x.ctid;
          n := n + 1;
        exception when unique_violation then null;
        end;
      end loop;
    end;
  end loop;
  -- meriter total = the ledger; the rank now held counts as already announced
  insert into public.meriter_totals as t (user_id, total, updated_at)
  select user_id, sum(pts)::int, now() from public.meriter_log where user_id = p_new group by 1
  on conflict (user_id) do update set total = excluded.total, updated_at = now();
  insert into public.push_sent (user_id, kind, night)
  select t.user_id, 'title:' || rk.title, '2100-01-01T00:00:00Z' from public.meriter_totals t cross join lateral public.olnu_rank_of(t.total) rk
   where t.user_id = p_new and rk.at > 0 on conflict do nothing;
  return n;
end $$;
revoke all on function public.olnu_move_user(uuid, uuid) from public, anon, authenticated;

create or replace function public.redeem_recovery(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.olnu_uid(); c public.recovery_codes; n int;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into c from public.recovery_codes where code = upper(replace(trim(coalesce(p_code, '')), ' ', '')) for update;
  if not found or c.used_at is not null or c.expires_at < now() then raise exception 'bad_code'; end if;
  if c.old_uid = me then raise exception 'same_account'; end if;
  n := public.olnu_move_user(c.old_uid, me);
  update public.recovery_codes set used_at = now(), used_by = me where code = c.code;
  return jsonb_build_object('ok', true, 'moved', n);
end $$;
revoke all on function public.redeem_recovery(text) from public, anon;
grant execute on function public.redeem_recovery(text) to authenticated;
