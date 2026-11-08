-- public.olnu_inv_resolve(p_uid uuid, p_keys text[], p_group_ids uuid[])
-- live md5(pg_get_functiondef) = a4507d966f499e906f6c93215a82b13b
CREATE OR REPLACE FUNCTION public.olnu_inv_resolve(p_uid uuid, p_keys text[], p_group_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[];
  g uuid;
begin
  foreach g in array coalesce(p_group_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.group_members m where m.group_id = g and m.user_id = p_uid) then
      raise exception 'not_member';
    end if;
  end loop;
  select coalesce(array_agg(distinct x.uid), '{}'::uuid[]) into v from (
    select c.uid from public.olnu_inv_cands(p_uid) c where c.k = any (coalesce(p_keys, '{}'::text[]))
    union
    select m.user_id from public.group_members m where m.group_id = any (coalesce(p_group_ids, '{}'::uuid[])) and m.user_id <> p_uid
  ) x;
  return v;
end; $function$;
