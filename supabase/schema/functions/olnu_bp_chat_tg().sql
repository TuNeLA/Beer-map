-- public.olnu_bp_chat_tg()
-- live md5(pg_get_functiondef) = 2b0534c8fb6321267c3909b7187911b1
CREATE OR REPLACE FUNCTION public.olnu_bp_chat_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.olnu_bp_tag('chat', new.id, new.group_id, new.user_id, new.created_at, new.w, new.h);
  exception when others then null;
  end;
  return null;
end; $function$;
