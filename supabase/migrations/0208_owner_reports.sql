-- 0208 TRUST & SAFETY · owner review of 🚩 reports (docs/stats.html "🚩 Anmälningar", owner key like the other panels).
-- Apple 1.2 wants "timely responses": the panel shows the age of every open report. Aim: answer within 24 h.
-- Additive. No row-removing or object-removing statement in this file.

create or replace function public.owner_reports(p_key text, p_status text default 'new')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('generated_at', now(),
    'open', (select count(*) from public.ugc_reports r where r.status = 'new'),
    'oldest_open_h', (select round(extract(epoch from now() - min(r.created_at)) / 3600.0, 1) from public.ugc_reports r where r.status = 'new'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'ref', r.ref, 'reason', r.reason, 'note', r.note, 'excerpt', r.excerpt,
        'status', r.status, 'created_at', r.created_at, 'handled_at', r.handled_at,
        -- how many different people reported the same thing, and how many reports this author got in 30 days
        'same', (select count(distinct x.reporter) from public.ugc_reports x where x.kind = r.kind and x.ref = r.ref),
        'author_30d', (select count(*) from public.ugc_reports x where x.target = r.target and x.created_at > now() - interval '30 days'),
        'author', case when r.target is null then null else substr(md5(r.target::text || ':olnu-rep'), 1, 8) end,
        'photo_id', (regexp_match(coalesce(r.excerpt, ''), '\[📷 ([0-9]+)\]'))[1]::bigint
      ) order by r.created_at desc)
      from (select * from public.ugc_reports x
             where (coalesce(p_status, 'new') = 'all' or x.status = coalesce(p_status, 'new'))
             order by x.created_at desc limit 300) r), '[]'::jsonb));
end; $$;

-- p_action: 'dismiss' (no action), 'hide' (remove the content + tell the author why), 'warn' (tell the author only),
--           'hide_all' (also end ALL of the author's live chat text/photos/voice now).
create or replace function public.owner_report_act(p_key text, p_id bigint, p_action text, p_notice text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.ugc_reports; v_notice text;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select * into r from public.ugc_reports x where x.id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if p_action not in ('dismiss', 'hide', 'warn', 'hide_all') then raise exception 'invalid_action'; end if;
  v_notice := nullif(left(btrim(coalesce(p_notice, '')), 300), '');
  if p_action in ('hide', 'hide_all') then
    v_notice := coalesce(v_notice, 'Något du la upp togs bort efter en anmälan, för att det bröt mot Reglerna. Frågor: support@pintsnow.com');
    perform public.olnu_safety_hide(r.kind, r.ref);
    if r.kind in ('name', 'person') and r.target is not null then
      update public.user_names n set name = 'Soldat', updated_at = now() where n.user_id = r.target;
      update public.group_members m set display_name = 'Soldat' where m.user_id = r.target;
    elsif r.kind = 'avatar' and r.target is not null then
      update public.avatars a set spec = '{}'::jsonb, updated_at = now() where a.user_id = r.target;
    end if;
    if p_action = 'hide_all' and r.target is not null then
      update public.group_msgs m set expires_at = least(m.expires_at, now()) where m.user_id = r.target and m.expires_at > now();
      update public.chat_photos c set expires_at = least(c.expires_at, now()) where c.user_id = r.target and c.expires_at > now();
      update public.voice_msgs v set expires_at = least(v.expires_at, now()) where v.user_id = r.target and v.expires_at > now();
    end if;
  elsif p_action = 'warn' then
    v_notice := coalesce(v_notice, 'Hej! Någon anmälde något du skrev. Håll god ton i gänget, la. Reglerna finns under ⚙️.');
  else
    v_notice := null;
  end if;
  -- every open report about the same thing gets the same answer
  update public.ugc_reports x
     set status = case p_action when 'dismiss' then 'dismissed' when 'warn' then 'warned' else 'hidden' end,
         handled_at = now(),
         notice = case when x.id = r.id then v_notice else x.notice end
   where x.id = r.id or (x.kind = r.kind and x.ref = r.ref and x.status = 'new');
  return jsonb_build_object('ok', true, 'status', p_action);
end; $$;

-- The reported chat photo as base64 (owner only), so the owner can judge it in stats.html.
create or replace function public.owner_report_photo(p_key text, p_photo_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.chat_photos;
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  select * into c from public.chat_photos x where x.id = p_photo_id
     and exists (select 1 from public.ugc_reports r where r.excerpt like '%[📷 ' || p_photo_id::text || ']%');
  if c.id is null or c.bytes is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'mime', c.mime, 'b64', encode(c.bytes, 'base64'));
end; $$;

grant execute on function public.owner_reports(text, text) to anon, authenticated;
grant execute on function public.owner_report_act(text, bigint, text, text) to anon, authenticated;
grant execute on function public.owner_report_photo(text, bigint) to anon, authenticated;
