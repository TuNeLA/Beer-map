-- public.owner_stats2(p_key text)
-- live md5(pg_get_functiondef) = a9b91ee495d20f91a00585da84361504
CREATE OR REPLACE FUNCTION public.owner_stats2(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v       jsonb := public.owner_stats(p_key);   -- does the key check, rate limit and fail log
  v_now   timestamptz := now();
  v_next  timestamptz := public.olnu_next_expiry();
  v_today timestamptz := date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm';
  v_users jsonb;
begin
  if v is null or v ? 'code' or not (v ? 'users') then return v; end if;   -- forbidden / rate limited
  create temporary table if not exists olnu_tmp_real on commit drop as
    select u.id, u.created_at from auth.users u where not public.olnu_is_test_uid(u.id);
  v_users := (v -> 'users') || jsonb_build_object(
    'total', (select count(*) from olnu_tmp_real),
    'named', (select count(distinct g.user_id) from public.group_members g join olnu_tmp_real r on r.id = g.user_id),
    'new_today', (select count(*) from olnu_tmp_real where created_at >= v_today),
    'new_7d', (select count(*) from olnu_tmp_real where created_at > v_now - interval '7 days'),
    'new_30d', (select count(*) from olnu_tmp_real where created_at > v_now - interval '30 days'),
    'active_tonight', (select count(distinct a.uid) from (
        select b.user_id uid from public.beers b
         where b.expires_at = v_next and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) + coalesce(b.shot_count, 0)) > 0
        union all
        select c.user_id from public.checkins c where c.expires_at = v_next) a join olnu_tmp_real r on r.id = a.uid),
    'out_now', (select count(*) from public.beers b join olnu_tmp_real r on r.id = b.user_id
                 where b.expires_at > v_now and not coalesce(b.stopped, false)),
    'opened_7d', (select count(distinct s.user_id) from auth.sessions s join olnu_tmp_real r on r.id = s.user_id
                   where s.updated_at > v_now - interval '7 days'),
    'push', (select count(distinct p.user_id) from public.push_subscriptions p join olnu_tmp_real r on r.id = p.user_id),
    'test_users', (select count(*) from auth.users) - (select count(*) from olnu_tmp_real),
    'empty_anon', (select count(*) from olnu_tmp_real r
                    where not exists (select 1 from public.group_members g where g.user_id = r.id)
                      and not exists (select 1 from public.beers b where b.user_id = r.id)
                      and not exists (select 1 from public.checkins c where c.user_id = r.id)),
    'real_only', true);
  return jsonb_set(v, '{users}', v_users);
end;
$function$;
