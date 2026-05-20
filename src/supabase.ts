import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
export const TABLE = (import.meta.env.VITE_FIREFLIES_TABLE ?? 'usr_nmexs7bytxq2_fireflies').trim();

export const SILENT_LIFESPAN_S = 300;
export const WISH_LIFESPAN_S = 600;
export const WISH_MAX_LEN = 80;

export type FireflyRow = {
  id: string;
  x: number;
  y: number;
  hue: number;
  wish: string | null;
  lifespan_seconds: number;
  born_at: string;
};

export const hasSupabase = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } }
    })
  : null;
