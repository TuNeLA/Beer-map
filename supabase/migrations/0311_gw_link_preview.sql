-- 0311 🔗 LÄNKFÖRHANDSVISNING UTAN KONTO (competitor research idea 2, Partiful). Additive only.
-- join_preview (0086) and ev_preview (0125) need a session, so a first visitor (0222: no account until the first
-- real action) had to get an account just to SEE an invite. link_preview works for anon AND authenticated and returns
-- only public-safe data: names (first name only), counts, the event title / text place / time. Never a position,
-- never a user id, never the group code back.
--   link_preview('join', '<6-char group code>') → {ok, kind:'join', name, members, ute, faces:[{n, ute}]}
--   link_preview('ev',   '<6-char event token>') → {ok, kind:'ev', title, ev_kind, place, starts_at, live, yes, maybe,
--                                                    from, faces:[{n}]}
--   errors: {ok:false, why:'not_found'|'slow_down'|'bad_kind'}
-- Rate limit per client (hash of the IP from the PostgREST request headers, never stored in clear): 40 reads and
-- 8 wrong codes per 10 minutes. Without headers (direct SQL) all calls share one key with a 2000 / 10 min limit.
-- Counter rows are one per client per 10 min (gw_link_hits); no row is ever removed here. Safe to run again.

create table if not exists public.gw_link_hits (
  k    text not null,
  slot bigint not null,          -- floor(epoch / 600)
  n    int not null default 0,
  bad  int not null default 0,
  primary key (k, slot)
);
alter table public.gw_link_hits enable row level security;
revoke all on table public.gw_link_hits from public, anon, authenticated;

create or replace function public.olnu_gw_client_key()
returns text language plpgsql stable set search_path to 'public' as $$
declare v_h json; v_ip text;
begin
  begin v_h := nullif(current_setting('request.headers', true), '')::json; exception when others then v_h := null; end;
  if v_h is null then return 'none'; end if;
  v_ip := btrim(coalesce(v_h->>'cf-connecting-ip', split_part(coalesce(v_h->>'x-forwarded-for', ''), ',', 1), v_h->>'x-real-ip', ''));
  if v_ip = '' then return 'none'; end if;
  return md5('olnu-gw|' || v_ip);
end $$;

create or replace function public.link_preview(p_kind text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_k text := public.olnu_gw_client_key();
  v_slot bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_n int; v_bad int;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_night timestamptz := public.olnu_night_of(now());
  g public.groups%rowtype; l public.ev_links%rowtype; i public.invites%rowtype;
  v_mem int; v_ute int; v_faces jsonb; v_yes int; v_maybe int;
begin
  insert into public.gw_link_hits as h (k, slot, n) values (v_k, v_slot, 1)
  on conflict (k, slot) do update set n = h.n + 1
  returning h.n, h.bad into v_n, v_bad;
  if v_n > (case when v_k = 'none' then 2000 else 40 end) or v_bad >= (case when v_k = 'none' then 200 else 8 end) then
    return jsonb_build_object('ok', false, 'why', 'slow_down');
  end if;
  if v_kind not in ('join', 'ev') then return jsonb_build_object('ok', false, 'why', 'bad_kind'); end if;

  if v_kind = 'join' then
    if char_length(v_code) = 6 then select * into g from public.groups x where x.code = v_code; end if;
    if g.id is null or public.olnu_is_temp_group(g.id) then
      update public.gw_link_hits set bad = bad + 1 where k = v_k and slot = v_slot;
      return jsonb_build_object('ok', false, 'why', 'not_found');
    end if;
    select count(*)::int into v_mem from public.group_members m where m.group_id = g.id;
    with mm as (
      select m.user_id, m.display_name, m.joined_at,
             (exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at > now()
                        and not coalesce(b.stopped, false) and not coalesce(b.ghost, false))
              or exists (select 1 from public.ikvall_status s where s.user_id = m.user_id and s.night = v_night and s.st = 'ute')) as ute
        from public.group_members m where m.group_id = g.id
    )
    select count(*) filter (where mm.ute)::int,
           coalesce((select jsonb_agg(jsonb_build_object('n', f.n, 'ute', f.ute)) from (
              select public.olnu_card_first(x.display_name) as n, x.ute from mm x
               where public.olnu_card_first(x.display_name) is not null
               order by x.ute desc, x.joined_at limit 8) f), '[]'::jsonb)
      into v_ute, v_faces from mm;
    return jsonb_build_object('ok', true, 'kind', 'join', 'name', g.name, 'members', v_mem, 'ute', coalesce(v_ute, 0), 'faces', v_faces);
  end if;

  if char_length(v_code) = 6 then select * into l from public.ev_links x where x.token = v_code and x.expires_at > now(); end if;
  if l.token is not null then select * into i from public.invites x where x.id = l.invite_id; end if;
  if i.id is null then
    update public.gw_link_hits set bad = bad + 1 where k = v_k and slot = v_slot;
    return jsonb_build_object('ok', false, 'why', 'not_found');
  end if;
  select count(*) filter (where p.answer = 'yes')::int, count(*) filter (where p.answer = 'maybe')::int into v_yes, v_maybe
    from public.invite_people p where p.invite_id = i.id;
  select coalesce(jsonb_agg(jsonb_build_object('n', f.n)), '[]'::jsonb) into v_faces from (
    select public.olnu_card_first(public.olnu_friend_name(p.user_id)) as n
      from public.invite_people p
     where p.invite_id = i.id and p.answer = 'yes' and public.olnu_card_first(public.olnu_friend_name(p.user_id)) is not null
     order by (p.user_id = i.creator) desc, p.answered_at nulls last limit 8) f;
  return jsonb_build_object('ok', true, 'kind', 'ev', 'title', i.title, 'ev_kind', i.kind, 'place', i.place,
    'starts_at', i.starts_at, 'live', i.status = 'open' and i.ends_at > now(), 'yes', v_yes, 'maybe', v_maybe,
    'from', public.olnu_card_first(public.olnu_friend_name(l.creator)), 'faces', v_faces);
end $$;

revoke all on function public.olnu_gw_client_key() from public, anon, authenticated;
revoke all on function public.link_preview(text, text) from public;
grant execute on function public.link_preview(text, text) to anon, authenticated;
