export interface Env {
  DB: D1Database;
  // Public-by-design (see wrangler.toml) — used only to verify a Google-signed Supabase
  // Auth JWT via a plain fetch to Supabase's Auth REST endpoint. No other Supabase
  // dependency remains; all data lives in D1.
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  GEMINI_API_KEY?: string;
  SUPER_PASSWORD?: string;
  LEADER_PASSWORD?: string;
  WELCOMING_PASSWORD?: string;
}
