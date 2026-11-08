-- public.owner_bar_reports(p_key text)
-- live md5(pg_get_functiondef) = 50f76a24b29827c371b8612462696b05
CREATE OR REPLACE FUNCTION public.owner_bar_reports(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'total_new', (select count(*) from public.bar_reports r where r.status = 'new'),
    'bars', coalesce((select jsonb_agg(x order by (x->>'users')::int desc, x->>'last_at' desc) from (
      select jsonb_build_object('bar_id', r.bar_id, 'bar_name', max(r.bar_name), 'users', count(distinct r.user_id), 'reports', count(*),
        'kinds', (select jsonb_object_agg(k.kind, k.n) from (select r2.kind, count(*) n from public.bar_reports r2 where r2.bar_id = r.bar_id and r2.status = 'new' group by 1) k),
        'notes', (select coalesce(jsonb_agg(n.note order by n.created_at desc), '[]'::jsonb) from (select r3.note, r3.created_at from public.bar_reports r3 where r3.bar_id = r.bar_id and r3.status = 'new' and r3.note is not null order by r3.created_at desc limit 5) n),
        'user_pos', (select coalesce(jsonb_agg(jsonb_build_array(p.user_lat, p.user_lng)), '[]'::jsonb) from (select distinct r4.user_lat, r4.user_lng from public.bar_reports r4 where r4.bar_id = r.bar_id and r4.status = 'new' and r4.kind = 'wrong_place' and r4.user_lat is not null limit 5) p),
        'lat', max(r.bar_lat), 'lng', max(r.bar_lng),
        'active', (select b.active from public.bars_lite b where b.id = r.bar_id),
        'first_at', min(r.created_at), 'last_at', max(r.created_at)) x
      from public.bar_reports r where r.status = 'new' group by r.bar_id limit 300) q), '[]'::jsonb));
end; $function$;
