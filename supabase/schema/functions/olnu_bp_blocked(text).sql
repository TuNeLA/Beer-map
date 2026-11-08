-- public.olnu_bp_blocked(p text)
-- live md5(pg_get_functiondef) = 2e38a3c1ba862f87eca1aec004f971b8
CREATE OR REPLACE FUNCTION public.olnu_bp_blocked(p text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(p, '') ~* '(https?:|www\.|://|@|\.(se|com|nu|net|org|io|app|info|biz|ly|me|co|eu)(\M|/))'
      or regexp_replace(coalesce(p, ''), '[\s().+–-]', '', 'g') ~ '[0-9]{7,}'
      or coalesce(p, '') ~* '\m(hora|horor|horan|fitta|fittor|fittan|kuk|kukar|kuken|knulla|knullar|neger|negrer|nigger|niggers|nigga|blatte|blattar|svartskalle|zigge|bögjävel|retard|mongo|cunt|whore|faggot|nazi|sieg heil|våldta|våldtäkt|rape|kill yourself)\M';
$function$;
