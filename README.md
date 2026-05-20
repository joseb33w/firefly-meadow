# 🪲 FireflyMeadow

A tiny, dark, calm shared meadow. Tap anywhere to release a firefly — everyone visiting the site sees everyone's fireflies, live. Whisper a wish first and your firefly carries it; tap a wished firefly to read its wish. Silent fireflies live 5 minutes, wished ones 10.

No login. No accounts. Just the meadow.

## Stack

- **Vite + vanilla TypeScript** — no framework. ~60 KB gzipped, including the Supabase SDK.
- **Canvas 2D** — additive-blended radial gradients for the bloom, with a pulsing aura for wished fireflies.
- **Supabase Postgres + Realtime** — one table, RLS-locked, INSERT-only for the public.
- **Web Audio API** — soft cricket-and-wind ambient + hue-tuned chime on release + a softer chime when other people's wishes arrive.

## How it feels

- Tap (or click) anywhere on the meadow to release a firefly with a random warm hue (gold, amber, peach, pink-orange).
- Type something into the wish input at the bottom first and the firefly carries that wish for 10 minutes instead of 5, with a soft pulsing aura around it. The input clears on release.
- Tap a wished firefly (you'll feel the bigger silhouette) to see its wish for 4 seconds. Silent fireflies have no tooltip.
- Tap, drag off, release → nothing happens. Prevents accidental double-actions.
- A tiny pill in the top corner counts how many fireflies are currently glowing across all visitors. The "?" icon shows a single line of help.

## Backend schema

One table: `usr_nmexs7bytxq2_fireflies`. Full migration in [`supabase/schema.sql`](./supabase/schema.sql).

```sql
CREATE TABLE public.usr_nmexs7bytxq2_fireflies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  x                double precision NOT NULL,        -- 0.0..1.0 normalized
  y                double precision NOT NULL,        -- 0.0..1.0 normalized
  hue              integer NOT NULL,                 -- 0..59 (warm range)
  wish             text,                             -- CHECK length 0..80
  lifespan_seconds integer NOT NULL DEFAULT 300,     -- CHECK in (300, 600)
  born_at          timestamptz NOT NULL DEFAULT now()
);

-- anon can read while the per-row lifespan hasn't expired
CREATE POLICY "anon_read_recent" ON public.usr_nmexs7bytxq2_fireflies
  FOR SELECT TO anon, authenticated
  USING (born_at + (lifespan_seconds * interval '1 second') > now());

-- anon can insert; lifespan must be one of (300, 600), wish ≤ 80 chars
CREATE POLICY "anon_insert" ON public.usr_nmexs7bytxq2_fireflies
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1
    AND hue >= 0 AND hue < 360
    AND lifespan_seconds IN (300, 600)
    AND (wish IS NULL OR char_length(wish) <= 80)
  );

GRANT SELECT, INSERT ON public.usr_nmexs7bytxq2_fireflies TO anon, authenticated;
ALTER TABLE public.usr_nmexs7bytxq2_fireflies REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.usr_nmexs7bytxq2_fireflies;
```

No `UPDATE`, no `DELETE` grants — rows naturally drop off the read window when `born_at + lifespan_seconds` passes.

## Local development

```bash
cp .env.example .env       # then fill in your values
npm install
npm run dev                # http://localhost:5173
```

A debug bridge (`window.__ffm`) is exposed only when building with `VITE_DEBUG=1`; the production build is clean.

## Deploying

This repo ships with a GitHub Actions workflow at `.github/workflows/deploy.yml` that builds and deploys to GitHub Pages on every push to `main`.

### One-time setup

1. **Enable Pages**: go to `Settings → Pages` → Source: `GitHub Actions`.
2. **(Optional) Add secrets** at `Settings → Secrets and variables → Actions`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_FIREFLIES_TABLE`

   If you don't set them, the workflow uses the defaults baked into the workflow file (matching the table provisioned for this project). The Supabase anon key is a *publishable* key designed to live in the browser bundle — it's safe.

3. Push to `main`. The workflow builds with Vite, copies `index.html` to `404.html` (so GitHub Pages' subpath quirks don't break direct-link reloads), and publishes `dist/` to Pages.

The live URL will be `https://<your-user>.github.io/firefly-meadow/`.

## File layout

```
.
├── index.html              # mount point, HUD, wish bar, all styles
├── src/
│   ├── main.ts             # rendering loop, firefly physics, gesture, Supabase wiring
│   ├── supabase.ts         # client + types + lifespan constants
│   └── audio.ts            # ambient pad + release chime + softer wish-arrival chime
├── supabase/schema.sql     # full migration with RLS + Realtime
├── .github/workflows/deploy.yml
└── vite.config.ts
```
