-- 0207 TRUST & SAFETY · ordfilter (store-compliance A4.4). Short, maintainable slur list; MASK, never reject.
-- Masking keeps old clients working (no new error codes on post RPCs). "fitta" → "f****".
-- Works through BEFORE INSERT/UPDATE triggers, so every post RPC (old and new) is covered with no RPC change.
-- Live rule: the triggers do nothing while store_mode = 'off' (olnu_store_on()), so nothing changes before release.
-- Add a word:   insert into public.ugc_badwords (pattern, note) values ('\mexempel\w*', 'why');
-- Turn one off: update public.ugc_badwords set active = false where pattern = '...';
-- Patterns are Postgres regex (ARE), matched case-insensitive. \m = word start. Keep them short.
-- No row-removing or object-removing statement in this file.

create table if not exists public.ugc_badwords (
  pattern    text primary key,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ugc_badwords enable row level security;
revoke all on public.ugc_badwords from anon, authenticated;

insert into public.ugc_badwords (pattern, note) values
  -- racist slurs (sv + en)
  ('\mneger\w*', 'rasistiskt'), ('\mnegr(o|er)\w*', 'rasistiskt'), ('\mnigg\w*', 'racist'), ('\mnigga\w*', 'racist'),
  ('\msvartskall\w*', 'rasistiskt'), ('\mblatt(e|ar)\w*', 'rasistiskt'), ('\mzigg?(e|ar)\w*', 'rasistiskt'),
  ('\mkike[s]?\M', 'racist'), ('\mspic[s]?\M', 'racist'), ('\mchink[s]?\M', 'racist'), ('\mpaki[s]?\M', 'racist'),
  ('\mapjävl\w*', 'rasistiskt'),
  -- homophobic / transphobic
  ('\mfaggot\w*', 'homophobic'), ('\mfag[s]?\M', 'homophobic'), ('\mtrann(y|ies)\M', 'transphobic'), ('\mbögjävl\w*', 'homofobt'),
  -- ableist
  ('\mmongo\w*', 'ableistiskt'), ('\mretard\w*', 'ableist'), ('\mcpskad\w*', 'ableistiskt'),
  -- sexual harassment words
  ('\mhor(a|or|unge)\w*', 'sexuellt trakasseri'), ('\mfitt(a|an|or)\w*', 'sexuellt trakasseri'), ('\mwhore[s]?\M', 'sexual harassment'),
  ('\mcunt\w*', 'sexual harassment'),   -- not 'slut': in Swedish it means 'the end'
  -- self-harm baiting
  ('\mkys\M', 'self-harm bait'), ('\mkill\s+your\s*self\M', 'self-harm bait'), ('\mta\s+livet\s+av\s+dig\M', 'self-harm bait')
on conflict (pattern) do nothing;

-- Mask every hit: the first letter stays, the rest becomes '*'. Returns the text unchanged when nothing matches.
create or replace function public.olnu_mask_text(p text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := p; r record; m text; i int;
begin
  if v is null or v = '' then return v; end if;
  for r in select b.pattern from public.ugc_badwords b where b.active loop
    i := 0;
    loop
      i := i + 1;
      exit when i > 20;
      m := substring(v from '(?i)(' || r.pattern || ')');
      exit when m is null or m = '' or m !~ '[^*]{2}';
      v := regexp_replace(v, '(?i)' || r.pattern, left(m, 1) || repeat('*', greatest(char_length(m) - 1, 1)));
    end loop;
  end loop;
  return v;
end; $$;
revoke all on function public.olnu_mask_text(text) from public, anon, authenticated;

-- Generic trigger: TG_ARGV = the text columns to mask. Never blocks a write (errors are swallowed).
create or replace function public.olnu_mask_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text; j jsonb; v text; w text; changed boolean := false;
begin
  if not public.olnu_store_on() then return new; end if;
  begin
    j := to_jsonb(new);
    foreach c in array tg_argv loop
      v := j ->> c;
      if v is not null then
        w := public.olnu_mask_text(v);
        if w is distinct from v then j := jsonb_set(j, array[c], to_jsonb(w)); changed := true; end if;
      end if;
    end loop;
    if changed then new := jsonb_populate_record(new, j); end if;
  exception when others then
    null;
  end;
  return new;
end; $$;

-- Text that other people read. (spel/party inputs are short game answers shown on the big screen: covered too.)
create or replace trigger olnu_mask_group_msgs      before insert or update of body on public.group_msgs        for each row execute function public.olnu_mask_tg('body');
create or replace trigger olnu_mask_group_members   before insert or update of display_name on public.group_members for each row execute function public.olnu_mask_tg('display_name');
create or replace trigger olnu_mask_user_names      before insert or update of name on public.user_names        for each row execute function public.olnu_mask_tg('name');
create or replace trigger olnu_mask_board_optin     before insert or update of name on public.board_optin       for each row execute function public.olnu_mask_tg('name');
create or replace trigger olnu_mask_invites         before insert or update of title, note on public.invites    for each row execute function public.olnu_mask_tg('title', 'note');
create or replace trigger olnu_mask_bar_offers      before insert or update of body on public.bar_offers        for each row execute function public.olnu_mask_tg('body');
create or replace trigger olnu_mask_rallies         before insert or update of body on public.rallies           for each row execute function public.olnu_mask_tg('body');
create or replace trigger olnu_mask_bar_tips        before insert or update of body on public.bar_tips          for each row execute function public.olnu_mask_tg('body');
create or replace trigger olnu_mask_gang_quotes     before insert or update of body, who on public.gang_quotes  for each row execute function public.olnu_mask_tg('body', 'who');
create or replace trigger olnu_mask_feature_wishes  before insert or update of body, name on public.feature_wishes for each row execute function public.olnu_mask_tg('body', 'name');
create or replace trigger olnu_mask_party_players   before insert or update of name on public.party_players     for each row execute function public.olnu_mask_tg('name');
create or replace trigger olnu_mask_spel_players    before insert or update of name on public.spel_players      for each row execute function public.olnu_mask_tg('name');
create or replace trigger olnu_mask_party_inputs    before insert or update of val on public.party_inputs       for each row execute function public.olnu_mask_tg('val');
create or replace trigger olnu_mask_bar_events      before insert or update of title on public.bar_events       for each row execute function public.olnu_mask_tg('title');

-- Owner helper (stats.html "🚩 Anmälningar" can show it): test a text without saving anything.
create or replace function public.owner_mask_test(p_key text, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.olnu_wd_owner_ok(p_key) then
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return jsonb_build_object('in', left(p_text, 500), 'out', public.olnu_mask_text(left(p_text, 500)),
                            'words', (select count(*) from public.ugc_badwords b where b.active));
end; $$;
grant execute on function public.owner_mask_test(text, text) to anon, authenticated;
