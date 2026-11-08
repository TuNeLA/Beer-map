-- public.olnu_tg_lines(p_kind text)
-- live md5(pg_get_functiondef) = 1c1e255c3bc03f57b27faaa45580a756
CREATE OR REPLACE FUNCTION public.olnu_tg_lines(p_kind text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_kind
    when 'made' then array[
      '📨 {namn} skapade eventet. Nu ä dä allvar!',
      '📨 {namn} skapade eventet. Generalstaben har talat.',
      '📨 {namn} har blåst till samling. Eventet ä skapat.',
      '📨 {namn} skapade eventet. Putsa kängorna, pojkar och jäntor.',
      '📨 Eventet ä skapat av {namn}. Hä ä bara å tacka ja.',
      '📨 {namn} skapade eventet. Ölguden ä underrättad.',
      '📨 {namn} drog igång eventet. Nu kör vi, int'' sant?',
      '📨 {namn} skapade eventet. Kallelsen ä ute i hela Dalom.',
      '📨 {namn} har skapat eventet. Ordern gäller tills vidare.',
      '📨 {namn} skapade eventet. Den som kommer sist bjuder på bärs.',
      '📨 {namn} skapade eventet. Hä blir gött, dä lovar vi.']
    when 'yes' then array[
      '✅ {namn} kommer! Truppen växer.',
      '✅ {namn} kommer. Hä ä klart som korvspad.',
      '✅ {namn} kommer ✅ Ställ fram ett glas till.',
      '✅ {namn} ä anmäld till tjänstgöring.',
      '✅ {namn} kommer. Nu börjar dä likna nåt!',
      '✅ {namn} kommer – mä kängorna på.',
      '✅ {namn} har sagt ja. Förstärkning på väg.',
      '✅ {namn} kommer. Int'' en chans att hen missar dä här.',
      '✅ {namn} kommer! Skål i förväg.',
      '✅ {namn} kommer. Generalen nickar gillande.',
      '✅ {namn} kommer. Ett streck till i liggaren.']
    when 'maybe' then array[
      '🤔 {namn} kanske. Vi håller en stol varm.',
      '🤔 {namn} kanske 🤔 Ett halvt ja ä oxå ett ja.',
      '🤔 {namn} kanske. Hä lutar åt ja, säger ryktet.',
      '🤔 {namn} funderar. Kanske, kanske int''.',
      '🤔 {namn} kanske. Övertala hen i chatten!',
      '🤔 {namn} ä kanske-med. Generalen väntar.',
      '🤔 {namn} kanske. Vi ställer fram ett glas för säkerhets skull.',
      '🤔 {namn} kanske. Hä avgörs nog vid fjärde ölen.',
      '🤔 {namn} har sagt kanske. Spaning pågår.',
      '🤔 {namn} kanske. Nån får locka mä en bärs.',
      '🤔 {namn} kanske. Stå på dig nu, korpral.']
    when 'soon' then array[
      '⏰ Om 1 timme! Dags att dra på sig kängorna.',
      '⏰ Om 1 timme! Sista chansen att duscha.',
      '⏰ Om 1 timme! Truppen samlas, inga ursäkter.',
      '⏰ Om 1 timme! Ladda telefonen å plånboken.',
      '⏰ Om 1 timme! Hä närmar sig, dä känns i magen.',
      '⏰ Om 1 timme! Ställ klockan, korpral.',
      '⏰ Om 1 timme! Ölen kallnar int'' av sig själv.',
      '⏰ Om 1 timme! Marschorder gäller från nu.',
      '⏰ Om 1 timme! Den som kommer sist bjuder, glöm int''.',
      '⏰ Om 1 timme! Nu ä dä bara att gå.',
      '⏰ Om 1 timme! Generalen räknar huvuden.']
    when 'cancel' then array[
      '🚫 Eventet ä inställt. Chatten ä stängd.',
      '🚫 Eventet ä inställt. Vila i baracken i stället.',
      '🚫 Eventet ä inställt. Ölguden gråter en skvätt.',
      '🚫 Eventet ä inställt. Reträtt, ingen skam i dä.',
      '🚫 Eventet ä inställt. Vi tar dä en annan kväll.',
      '🚫 Eventet ä inställt. Kängorna kan stå kvar i hallen.',
      '🚫 Eventet ä inställt. Ordern ä återkallad.',
      '🚫 Eventet ä inställt. Hä blev int'' nå den här gången.',
      '🚫 Eventet ä inställt. Truppen ä hemförlovad.',
      '🚫 Eventet ä inställt. Spara på bärsen till nästa gång.']
    else array['📨 {namn}'] end;
$function$;
