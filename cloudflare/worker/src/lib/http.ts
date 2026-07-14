import type { Context } from "hono";
import type { Env } from "../types";

export type C = Context<{ Bindings: Env }>;

export function ok(c: C, obj: unknown) {
  return c.json(obj as object);
}

export function fail(c: C, code: number, msg: string) {
  return c.json({ error: msg }, code as never);
}

// Mirrors the original edge function's `try { body = await req.json() } catch {}` —
// a missing/invalid JSON body degrades to {} rather than erroring the whole request.
export async function readBody(c: C): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
