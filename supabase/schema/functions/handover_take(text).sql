-- public.handover_take(p_id text)
-- live md5(pg_get_functiondef) = 24d959015c20d286f10c4ddab2f743e8
CREATE OR REPLACE FUNCTION public.handover_take(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  r public.handover_tickets%rowtype;
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{20,64}$' then raise exception 'handover_gone'; end if;
  select * into r from public.handover_tickets where id_hash = public.olnu_ho_hash(p_id) for update;
  if not found or r.done_at is not null or r.box = '' or r.expires_at < now() then raise exception 'handover_gone'; end if;
  if r.taken_at is not null and (now() - r.taken_at > interval '2 minutes' or r.takes >= 3) then
    raise exception 'handover_gone';
  end if;
  update public.handover_tickets
     set taken_at = coalesce(taken_at, now()), takes = takes + 1
   where id_hash = r.id_hash;
  return jsonb_build_object('box', r.box, 'u', r.user_id);
end;
$function$;
