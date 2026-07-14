// Small helpers for the jsonb-turned-TEXT columns and boolean-turned-INTEGER columns
// created by the Postgres -> SQLite translation (see cloudflare/README.md). Centralizing
// these mirrors how supabase-js's query builder transparently (de)serialized jsonb before.

export function toJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}

export function fromJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string" || !s) return fallback;
  try {
    const parsed = JSON.parse(s);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function toBool(v: unknown): boolean {
  return v === 1 || v === true;
}

export function toInt(v: unknown): number {
  return v ? 1 : 0;
}
