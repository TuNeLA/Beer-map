-- public.olnu_move_user(p_old uuid, p_new uuid)
-- live md5(pg_get_functiondef) = 50b74ec2d200a3ca38e06824b9aadc18
CREATE OR REPLACE FUNCTION public.olnu_move_user(p_old uuid, p_new uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  insert into public.meriter_totals as t (user_id, total, updated_at)
  select user_id, sum(pts)::int, now() from public.meriter_log where user_id = p_new group by 1
  on conflict (user_id) do update set total = excluded.total, updated_at = now();
  insert into public.push_sent (user_id, kind, night)
  select t.user_id, 'title:' || rk.title, '2100-01-01T00:00:00Z' from public.meriter_totals t cross join lateral public.olnu_rank_of(t.total) rk
   where t.user_id = p_new and rk.at > 0 on conflict do nothing;
  return n;
end $function$;
