-- public.bar_status()
-- live md5(pg_get_functiondef) = 8e297ae447802288ad64c63fe58c2599
CREATE OR REPLACE FUNCTION public.bar_status()
 RETURNS TABLE(bar_id text, queue text, queue_at timestamp with time zone, queue_n integer, entry text, offers jsonb, owner_name text, owner_n integer, owner_mine boolean, owner_named boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  with q as (
    select x.bar_id as bid,
           (select l.queue from public.bar_queue l where l.bar_id = x.bar_id and l.expires_at > now()
             group by l.queue order by count(*) desc, max(l.created_at) desc limit 1) as qv,
           (select l.entry from public.bar_queue l where l.bar_id = x.bar_id and l.expires_at > now() and l.entry is not null
             group by l.entry order by count(*) desc, max(l.created_at) desc limit 1) as ev,
           max(x.created_at) as qat, count(*)::int as qn
      from public.bar_queue x
     where x.expires_at > now()
     and (not public.olnu_is_test_zone(x.bar_lat, x.bar_lng) or (select public.olnu_is_test_user(v_uid)))
     group by x.bar_id
  ),
  ov as (
    select o.id, o.bar_id as bid, o.body, o.user_id, o.created_at,
           coalesce(sum(case when v.vote = 1 then 1 else 0 end), 0)::int as up,
           coalesce(sum(case when v.vote = -1 then 1 else 0 end), 0)::int as dn,
           coalesce(max(case when v.user_id = v_uid then v.vote end), 0)::int as mv
      from public.bar_offers o
      left join public.bar_offer_votes v on v.offer_id = o.id
     where o.expires_at > now()
     and (not public.olnu_is_test_zone(o.bar_lat, o.bar_lng) or (select public.olnu_is_test_user(v_uid)))
     group by o.id
  ),
  ovr as (
    select ov.*, row_number() over (partition by ov.bid order by (ov.up - ov.dn) desc, ov.created_at desc, ov.id) as rn
      from ov where (ov.dn - ov.up) < 3
  ),
  oj as (
    select ovr.bid, jsonb_agg(jsonb_build_object('id', ovr.id, 'body', ovr.body, 'up', ovr.up, 'down', ovr.dn,
             'my_vote', ovr.mv, 'is_mine', ovr.user_id = v_uid, 'at', ovr.created_at) order by ovr.rn) as js
      from ovr where ovr.rn <= 3 group by ovr.bid
  ),
  tk as (
    select t.bar_id as bid, t.group_id as gid, t.n as cnt,
           coalesce(f.show_on_map, false) as named,
           exists (select 1 from public.group_members m where m.group_id = t.group_id and m.user_id = v_uid) as mine
      from public.olnu_takeovers() t
      left join public.group_flags f on f.group_id = t.group_id
  ),
  ids as (select q.bid from q union select oj.bid from oj union select tk.bid from tk)
  select ids.bid, q.qv, q.qat, coalesce(q.qn, 0), q.ev, coalesce(oj.js, '[]'::jsonb),
         case when tk.gid is not null and (tk.named or tk.mine) then (select g.name from public.groups g where g.id = tk.gid) end,
         coalesce(tk.cnt, 0), coalesce(tk.mine, false), coalesce(tk.named, false)
    from ids
    left join q on q.bid = ids.bid
    left join oj on oj.bid = ids.bid
    left join tk on tk.bid = ids.bid
   order by ids.bid
   limit 2000;
end;
$function$;
