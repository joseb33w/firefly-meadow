# 🪲 FireflyMeadow

A tiny, dark, calm shared meadow. Tap anywhere to release a firefly — everyone visiting the site sees everyone's fireflies, live. Each firefly drifts, glows, breathes, and gently fades out exactly 5 minutes after it was born.

No login. No accounts. Just the meadow.

## Stack

- **Vite + vanilla TypeScript** — no framework. ~60 KB gzipped, including the Supabase SDK.
- **Canvas 2D** — additive-blended radial gradients for the bloom.
- **Supabase Postgres + Realtime** — one table, RLS-locked, INSERT-only for the public.
- **Web Audio API** — soft cricket-and-wind ambient + hue-tuned chime on release.

## How it feels

- Tap (or click) anywhere to release a firefly.
- It glows with a random warm hue (gold, amber, peach, pink-orange), drifts in a slow seeded random walk, breathes with a tiny pulse, and fades out over its last 30 seconds.
- A tiny pill in the corner counts how many fireflies are currently glowing across all visitors.
- The "?" icon shows a single line of help and dismisses on tap.

## Backend schema

One table: `usr_nmexs7bytxq2_fireflies`.

```sql
CREATE TABLE public.usr_nmexs7bytxq2_fireflies (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  x       double precision NOT NULL,   -- 0.0..1.0 normalized
  y       double precision NOT NULL,   -- 0.0..1.0 normalized
  hue     integer NOT NULL,            -- 0..59 (warm range)
  born_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.usr_nmexs7bytxq2_fireflies ENABLE ROW LEVEL SECURITY;

-- anon can read rows from the last 5 minutes only
CREATE POLICY "anon_read_recent" ON public.usr_nmexs7bytxq2_fireflies
  FOR SELECT TO anon, authenticated
  USING (born_at > now() - interval '5 minutes');

-- anon can insert, with x/y/hue bounds enforced
CREATE POLICY "anon_insert" ON public.usr_nmexs7bytxq2_fireflies
  FOR INSERT TO anon, authenticated
  WITH CHECK (x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND hue >= 0 AND hue < 360);

GRANT SELECT, INSERT ON public.usr_nmexs7bytxq2_fireflies TO anon, authenticated;
ALTER TABLE public.usr_nmexs7bytxq2_fireflies REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.usr_nmexs7bytxq2_fireflies;
```

The full migration is in [`supabase/schema.sql`](./supabase/schema.sql).

No `UPDATE`, no `DELETE` grants — rows naturally drop off the read window after 5 minutes.

## Local development

```bash
cp .env.example .env       # then fill in your values
npm install
npm run dev                # http://localhost:5173
```

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
├── index.html              # mount point, HUD markup, all styles
├── src/
│   ├── main.ts             # rendering loop, firefly physics, Supabase wiring
│   ├── supabase.ts         # client + table name from env
│   └── audio.ts            # ambient pad + hue-tuned chime
├── supabase/schema.sql     # full migration with RLS + Realtime
├── .github/workflows/deploy.yml
└── vite.config.ts
```
