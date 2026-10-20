-- Öl Nu v26 — owner DB size / storage warning for docs/stats.html. Read only, additive.
-- owner_db_stats(key) → jsonb {generated_at, db_bytes, limit_db_bytes (500 MB free plan), db_pct,
--   tables:[{name, bytes, table_bytes, index_bytes, toast_bytes, rows_est}] (top 25 public tables by size),
--   media:{photos:{bytes, rows, live_rows, live_bytes, kept_rows}, voices:{…}, status:{…}} (bytea payload sizes),
--   egress:{est_bytes_30d, limit_bytes (5 GB), pct, basis}} — an ESTIMATE: photo/voice bytes created in 30 days
--   × 3 views (each group member downloads once per device) + user-nights × ~1.4 MB app traffic (polls). Real
--   number: Supabase dashboard → Usage.
-- Wrong key → 403 forbidden (logged), > 20 fails/h → rate_limited (same as owner_stats).

create or replace function public.owner_db_stats(p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_db bigint := pg_database_size(current_database());
  v_lim bigint := 500 * 1024 * 1024;
  v_elim bigint := 5::bigint * 1024 * 1024 * 1024;
  v_tables jsonb; v_media jsonb := '{}'::jsonb; v_e bigint := 0; v_x jsonb; v_un bigint := 0;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', t.relname, 'bytes', t.total, 'table_bytes', t.tbl, 'index_bytes', t.idx,
           'toast_bytes', t.total - t.tbl - t.idx, 'rows_est', t.rows) order by t.total desc), '[]'::jsonb)
    into v_tables
    from (select c.relname, pg_total_relation_size(c.oid) total, pg_relation_size(c.oid) tbl, pg_indexes_size(c.oid) idx,
                 greatest(c.reltuples, 0)::bigint rows
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
           order by pg_total_relation_size(c.oid) desc limit 25) t;
  -- Media payloads (each part in its own block: a missing table on an old database is skipped).
  begin
    execute $q$select jsonb_build_object('bytes', coalesce(sum(octet_length(bytes)), 0), 'rows', count(*),
        'live_rows', count(*) filter (where bytes is not null and expires_at > now()),
        'live_bytes', coalesce(sum(octet_length(bytes)) filter (where expires_at > now()), 0),
        'kept_rows', count(*) filter (where expires_at = 'infinity'),
        'new_30d_bytes', coalesce(sum(size) filter (where created_at > now() - interval '30 days'), 0))
      from public.chat_photos$q$ into v_x;
    v_media := v_media || jsonb_build_object('photos', v_x);
    v_e := v_e + coalesce((v_x->>'new_30d_bytes')::bigint, 0);
  exception when others then null;
  end;
  begin
    execute $q$select jsonb_build_object('bytes', coalesce(sum(octet_length(audio)), 0), 'rows', count(*),
        'live_rows', count(*) filter (where expires_at > now()),
        'live_bytes', coalesce(sum(octet_length(audio)) filter (where expires_at > now()), 0),
        'kept_rows', count(*) filter (where expires_at = 'infinity'),
        'new_30d_bytes', coalesce(sum(octet_length(audio)) filter (where created_at > now() - interval '30 days'), 0))
      from public.voice_msgs$q$ into v_x;
    v_media := v_media || jsonb_build_object('voices', v_x);
    v_e := v_e + coalesce((v_x->>'new_30d_bytes')::bigint, 0);
  exception when others then null;
  end;
  begin
    -- "camera" = lägesrapport photos (0030): they are chat_photos rows linked from status_answers.
    execute $q$select jsonb_build_object('bytes', coalesce(sum(octet_length(p.bytes)), 0), 'rows', count(*))
      from public.status_answers a join public.chat_photos p on p.id = a.photo_id$q$ into v_x;
    v_media := v_media || jsonb_build_object('camera', v_x);
  exception when others then null;
  end;
  -- App traffic estimate: user-nights in 30 days × ~90 min open × 4 requests/min × ~4 KB ≈ 1.4 MB per user-night.
  begin
    execute $q$select count(*) from public.medal_nights m where m.night > now() - interval '30 days'$q$ into v_un;
  exception when others then v_un := 0;
  end;
  return jsonb_build_object('generated_at', now(), 'db_bytes', v_db, 'limit_db_bytes', v_lim, 'db_pct', round(100.0 * v_db / v_lim, 1),
    'tables', v_tables, 'media', v_media,
    'egress', jsonb_build_object('est_bytes_30d', v_e * 3 + v_un * 1400000, 'media_bytes_30d', v_e * 3, 'api_bytes_30d', v_un * 1400000,
      'user_nights_30d', v_un, 'limit_bytes', v_elim, 'pct', round(100.0 * (v_e * 3 + v_un * 1400000) / v_elim, 1),
      'basis', 'media created in 30 days × 3 downloads + user-nights × 1.4 MB app traffic (estimate; real number: dashboard → Usage)'));
end; $$;

revoke all on function public.owner_db_stats(text) from public;
grant execute on function public.owner_db_stats(text) to anon, authenticated;
