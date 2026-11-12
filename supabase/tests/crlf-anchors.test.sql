-- CR LF test for every anchor helper (w1-server, 0501). LOCAL / CI copy only. One transaction, ROLLBACK at the end.
-- Needs: a database with the helpers (snapshot + the release files, e.g. rh_lf / rh_crlf of scripts/ci/sql-rehearsal.mjs).
-- For each helper, two cases on a small test function with a 2-line anchor:
--   A. the function text has LF, the anchor and the new text have CR LF (= an anchor file pasted on Windows);
--   B. the function text has CR LF (= made by a pasted file in the same session), the anchor has LF.
-- Pass = the helper answers "ok …", the new text is in pg_get_functiondef, the function answers the new value,
--        and a helper with a marker answers "skip …" the 2nd time.
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -f supabase/tests/crlf-anchors.test.sql      Prints "name|ok|detail"; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE crlf_res (name text, ok boolean, detail text);

DO $t$
DECLARE
  h record; c text; fn text; sig regprocedure; body text; anc text; new_text text; mark text; r text; r2 text; got text;
  nl text;
BEGIN
  FOR h IN SELECT * FROM (VALUES
      ('olnu_sec_patch',   true),  ('olnu_tz_patch',    false), ('olnu_ub_patch',    false),
      ('olnu_load_patch',  false), ('olnu_fixp_patch',  true),  ('olnu_fixm_patch',  true),
      ('olnu_fixmo_patch', true)) v(helper, has_marker)
  LOOP
    IF to_regproc('public.' || h.helper) IS NULL THEN
      INSERT INTO crlf_res VALUES (h.helper, false, 'helper missing');
      CONTINUE;
    END IF;
    FOREACH c IN ARRAY array['A', 'B'] LOOP
      fn := 'w1_crlf_' || h.helper || '_' || lower(c);
      mark := 'crlfok' || lower(c) || replace(h.helper, '_', '');
      -- A: stored LF, anchor CR LF.  B: stored CR LF, anchor LF.
      nl := CASE WHEN c = 'B' THEN E'\r\n' ELSE E'\n' END;
      body := 'begin' || nl || '  -- line one' || nl || '  return ''a'';' || nl || 'end';
      EXECUTE format('create or replace function public.%I() returns text language plpgsql as %L', fn, body);
      nl := CASE WHEN c = 'A' THEN E'\r\n' ELSE E'\n' END;
      anc := '-- line one' || nl || '  return ''a'';';
      new_text := '-- line one ' || mark || nl || '  return ''b'';';
      sig := (fn || '()')::regprocedure;
      BEGIN
        IF h.has_marker THEN
          EXECUTE format('select public.%I($1, $2, $3, $4)', h.helper) INTO r USING sig, mark, array[anc], array[new_text];
          EXECUTE format('select public.%I($1, $2, $3, $4)', h.helper) INTO r2 USING sig, mark, array[anc], array[new_text];
        ELSE
          EXECUTE format('select public.%I($1, $2, $3)', h.helper) INTO r USING sig, array[anc], array[new_text];
          r2 := 'skip (no marker)';
        END IF;
        EXECUTE format('select public.%I()', fn) INTO got;
        INSERT INTO crlf_res VALUES (h.helper || ' case ' || c,
          r LIKE 'ok %' AND r2 LIKE 'skip%' AND got = 'b' AND position(mark in pg_get_functiondef(sig)) > 0,
          coalesce(r, 'null') || ' / ' || coalesce(r2, 'null') || ' / answer ' || coalesce(got, 'null'));
      EXCEPTION WHEN others THEN
        INSERT INTO crlf_res VALUES (h.helper || ' case ' || c, false, sqlerrm);
      END;
    END LOOP;
  END LOOP;
END $t$;

SELECT name || '|' || CASE WHEN ok THEN 't' ELSE 'f' END || '|' || detail FROM crlf_res ORDER BY name;
SELECT 'crlf-anchors total|' || CASE WHEN bool_and(ok) AND count(*) = 14 THEN 't' ELSE 'f' END || '|' || count(*) FILTER (WHERE ok) || ' of 14 ok' FROM crlf_res;
ROLLBACK;
