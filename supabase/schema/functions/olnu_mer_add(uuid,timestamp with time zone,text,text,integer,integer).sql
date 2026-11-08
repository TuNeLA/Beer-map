-- public.olnu_mer_add(p_uid uuid, p_night timestamp with time zone, p_kind text, p_ref text, p_pts integer, p_cap integer)
-- live md5(pg_get_functiondef) = fbddd958b1f3776f2c367ac46eb0e0cd
CREATE OR REPLACE FUNCTION public.olnu_mer_add(p_uid uuid, p_night timestamp with time zone, p_kind text, p_ref text, p_pts integer, p_cap integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_used int;
  v_pts  int := p_pts;
  v_got  int;
begin
  if p_uid is null or p_night is null or p_kind is null or coalesce(p_pts, 0) <= 0 then
    return 0;
  end if;
  if p_kind = 'drink' then v_pts := 5; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-mer:' || p_uid::text, 0));
  if p_cap is not null then
    select coalesce(sum(l.pts), 0)::int into v_used
      from public.meriter_log l where l.user_id = p_uid and l.night = p_night and l.kind = p_kind;
    if v_used >= p_cap then return 0; end if;
    v_pts := least(v_pts, p_cap - v_used);
  end if;
  insert into public.meriter_log (user_id, night, kind, ref, pts)
  values (p_uid, p_night, p_kind, coalesce(p_ref, ''), v_pts)
  on conflict (user_id, night, kind, ref) do nothing
  returning pts into v_got;
  return coalesce(v_got, 0);
end; $function$;
