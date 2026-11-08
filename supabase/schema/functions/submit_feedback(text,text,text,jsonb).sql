-- public.submit_feedback(p_kind text, p_text text, p_answer text, p_meta jsonb)
-- live md5(pg_get_functiondef) = 85325028d4c7a18824fede799705de50
CREATE OR REPLACE FUNCTION public.submit_feedback(p_kind text, p_text text DEFAULT NULL::text, p_answer text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_kind text := lower(coalesce(p_kind, ''));
  v_body text := nullif(left(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), 1000), '');
  v_ans text := nullif(left(lower(coalesce(p_answer, '')), 40), '');
  v_meta jsonb := '{}'::jsonb;
  v_id bigint;
begin
  if v_uid is null then raise exception 'not_authed'; end if;
  if v_kind not in ('wish', 'bug', 'morning') then raise exception 'invalid_kind'; end if;
  if v_kind = 'morning' and (v_ans is null or v_ans !~ '^[a-z_]{2,40}$') then raise exception 'invalid_answer'; end if;
  if v_kind <> 'morning' and (v_body is null or char_length(trim(v_body)) < 3) then raise exception 'too_short'; end if;
  if jsonb_typeof(p_meta) = 'object' then
    select coalesce(jsonb_object_agg(k, left(p_meta->>k, 300)), '{}'::jsonb) into v_meta
      from unnest(array['v', 'ua', 'screen', 'err', 'w', 'h', 'standalone']) k where p_meta ? k;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_fb:' || v_uid::text, 0));
  if exists (select 1 from public.app_feedback f where f.user_id = v_uid and f.created_at > now() - interval '10 seconds')
     or (select count(*) from public.app_feedback f where f.user_id = v_uid and f.created_at > now() - interval '1 day') >= 10 then
    raise exception 'slow_down';
  end if;
  if v_kind = 'morning' and exists (select 1 from public.app_feedback f where f.user_id = v_uid and f.kind = 'morning'
       and f.created_at > now() - interval '20 hours') then
    raise exception 'slow_down';
  end if;
  insert into public.app_feedback (user_id, kind, body, answer, meta) values (v_uid, v_kind, v_body, v_ans, v_meta) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $function$;
