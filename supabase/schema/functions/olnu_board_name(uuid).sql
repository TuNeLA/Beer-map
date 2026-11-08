-- public.olnu_board_name(p_uid uuid)
-- live md5(pg_get_functiondef) = 1de4408a112edc03dfbc600d4019b1b0
CREATE OR REPLACE FUNCTION public.olnu_board_name(p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when o.show then coalesce(o.name, (select min(m.display_name) from public.group_members m where m.user_id = p_uid)) end
    from public.board_optin o where o.user_id = p_uid;
$function$;
