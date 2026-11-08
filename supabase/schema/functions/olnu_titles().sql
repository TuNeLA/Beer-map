-- public.olnu_titles()
-- live md5(pg_get_functiondef) = 40d78adcd1caf4a25a57a8f07a5bc700
CREATE OR REPLACE FUNCTION public.olnu_titles()
 RETURNS TABLE(at integer, title text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select * from (values
    (0, 'Rekryt'), (5, 'Mönstrad Mellanöl'), (10, 'Menig Mjöd'), (18, 'Vicekorpral Kapsyl'),
    (28, 'Korpral Korkskruv'), (40, 'Skumsergeant'), (52, 'Översergeant Sejdel'), (66, 'Furir Flaskhals'),
    (82, 'Överfurir Fatkran'), (100, 'Fanjunkare Flasköppnare'), (125, 'Fänrik Fatöl'), (150, 'Löjtnant Lager'),
    (180, 'Premiärlöjtnant Pilsner'), (215, 'Kapten Kaggen'), (255, 'Kommendörkapten Krus'), (300, 'Ryttmästare Humle'),
    (350, 'Major Mäsk'), (410, 'Överstelöjtnant Ölstop'), (475, 'Överste Ölkorv'), (550, 'Brigadgeneral Bärs'),
    (630, 'Flottiljamiral Flaskpost'), (720, 'Generalmajor Gambrinus'), (820, 'Generallöjtnant Guldskum'),
    (930, 'General Gyllenbärs'), (1050, 'Amiral Ankarstout'), (1180, 'Fältmarskalk Fradga'),
    (1320, 'Storamiral Skumtopp'), (1470, 'Riksmarskalk Rundtur'), (1640, 'Baron av Bryggstugan'),
    (1830, 'Hertig av Humlefältet'), (2040, 'Ärkehertig av Ölkranen'), (2270, 'Kung Kapsyl den Store'),
    (2520, 'Ölkejsaren'), (2800, 'Bryggerilegenden'), (3100, 'Halvguden vid Jäskaret'), (3450, 'Myten i Mässen'),
    (3850, 'Legenden vid Långbordet'), (4300, 'Sagofiguren i Skyttegraven'), (4800, 'Oraklet i Ölstugan'),
    (5400, 'Överbefälhavare Öl'), (6200, 'Generalissimus Glaset'), (7000, 'Ölguden')
  ) as t(at, title);
$function$;
