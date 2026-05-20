-- FireflyMeadow: shared anonymous firefly meadow with optional wishes
-- Single table, RLS-locked. Anon can read rows whose per-row lifespan hasn't expired,
-- and can insert (silent → lifespan 300s, wished → lifespan 600s).
-- No update, no delete (rows naturally drop off the read window).

CREATE TABLE IF NOT EXISTS public.usr_nmexs7bytxq2_fireflies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  x double precision NOT NULL,
  y double precision NOT NULL,
  hue integer NOT NULL,
  wish text,
  lifespan_seconds integer NOT NULL DEFAULT 300,
  born_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.usr_nmexs7bytxq2_fireflies
  ADD COLUMN IF NOT EXISTS wish text;

ALTER TABLE public.usr_nmexs7bytxq2_fireflies
  ADD COLUMN IF NOT EXISTS lifespan_seconds integer NOT NULL DEFAULT 300;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.usr_nmexs7bytxq2_fireflies'::regclass
      AND conname = 'usr_nmexs7bytxq2_fireflies_wish_len_chk'
  ) THEN
    ALTER TABLE public.usr_nmexs7bytxq2_fireflies
      ADD CONSTRAINT usr_nmexs7bytxq2_fireflies_wish_len_chk
      CHECK (wish IS NULL OR char_length(wish) BETWEEN 0 AND 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.usr_nmexs7bytxq2_fireflies'::regclass
      AND conname = 'usr_nmexs7bytxq2_fireflies_lifespan_chk'
  ) THEN
    ALTER TABLE public.usr_nmexs7bytxq2_fireflies
      ADD CONSTRAINT usr_nmexs7bytxq2_fireflies_lifespan_chk
      CHECK (lifespan_seconds IN (300, 600));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS usr_nmexs7bytxq2_fireflies_born_at_idx
  ON public.usr_nmexs7bytxq2_fireflies (born_at DESC);

ALTER TABLE public.usr_nmexs7bytxq2_fireflies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_recent" ON public.usr_nmexs7bytxq2_fireflies;
CREATE POLICY "anon_read_recent"
  ON public.usr_nmexs7bytxq2_fireflies
  FOR SELECT
  TO anon, authenticated
  USING (born_at + (lifespan_seconds * interval '1 second') > now());

DROP POLICY IF EXISTS "anon_insert" ON public.usr_nmexs7bytxq2_fireflies;
CREATE POLICY "anon_insert"
  ON public.usr_nmexs7bytxq2_fireflies
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    x >= 0 AND x <= 1
    AND y >= 0 AND y <= 1
    AND hue >= 0 AND hue < 360
    AND lifespan_seconds IN (300, 600)
    AND (wish IS NULL OR char_length(wish) <= 80)
  );

GRANT SELECT, INSERT ON public.usr_nmexs7bytxq2_fireflies TO anon;
GRANT SELECT, INSERT ON public.usr_nmexs7bytxq2_fireflies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usr_nmexs7bytxq2_fireflies TO service_role;

ALTER TABLE public.usr_nmexs7bytxq2_fireflies REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'usr_nmexs7bytxq2_fireflies'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.usr_nmexs7bytxq2_fireflies';
  END IF;
END $$;
