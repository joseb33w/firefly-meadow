-- FireflyMeadow: shared anonymous firefly meadow
-- Single table, RLS-locked: anon can read rows from the last 5 minutes, anon can insert.
-- No update, no delete (rows naturally drop off the read window).

CREATE TABLE IF NOT EXISTS public.usr_nmexs7bytxq2_fireflies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  x double precision NOT NULL,
  y double precision NOT NULL,
  hue integer NOT NULL,
  born_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usr_nmexs7bytxq2_fireflies_born_at_idx
  ON public.usr_nmexs7bytxq2_fireflies (born_at DESC);

ALTER TABLE public.usr_nmexs7bytxq2_fireflies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_recent" ON public.usr_nmexs7bytxq2_fireflies;
CREATE POLICY "anon_read_recent"
  ON public.usr_nmexs7bytxq2_fireflies
  FOR SELECT
  TO anon, authenticated
  USING (born_at > now() - interval '5 minutes');

DROP POLICY IF EXISTS "anon_insert" ON public.usr_nmexs7bytxq2_fireflies;
CREATE POLICY "anon_insert"
  ON public.usr_nmexs7bytxq2_fireflies
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    x >= 0 AND x <= 1
    AND y >= 0 AND y <= 1
    AND hue >= 0 AND hue < 360
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
