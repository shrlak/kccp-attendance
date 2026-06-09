import { createClient } from '@supabase/supabase-js'

// Both values are publishable (by design public; all data is protected by the
// service-role edge function + deny-all RLS). Hardcoded as fallbacks so the app
// works even when VITE_* env vars aren't injected into the build.
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://loovulhchmmwagtvjnhc.supabase.co'
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxvb3Z1bGhjaG1td2FndHZqbmhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMjgwMjYsImV4cCI6MjA5NDcwNDAyNn0.pas9sWiiT26k-VDSAhj5U5mnhw20QyMzTcfzjeE2aD8'

export const supabase = createClient(url, anonKey)
