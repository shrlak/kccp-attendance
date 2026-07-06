// Run with: deno test supabase/functions/attendance-api/gemini.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import { buildGeminiBody, parseGeminiCard, CARD_PROMPT, CARD_SCHEMA } from "./gemini.ts";

Deno.test("buildGeminiBody: image part first, prompt second, structured-output config", () => {
  const b = buildGeminiBody("QUJD", "image/jpeg");
  assertEquals(b.contents.length, 1);
  const parts = b.contents[0].parts;
  assertEquals(parts[0], { inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
  assertEquals(parts[1], { text: CARD_PROMPT });
  assertEquals(b.generationConfig.temperature, 0);
  assertEquals(b.generationConfig.responseMimeType, "application/json");
  assertEquals(b.generationConfig.responseSchema, CARD_SCHEMA);
});

Deno.test("CARD_SCHEMA: every property is nullable and required (null = illegible, not omitted)", () => {
  const props = Object.keys(CARD_SCHEMA.properties);
  assertEquals(props.length, 11);
  assertEquals([...CARD_SCHEMA.required].sort(), [...props].sort());
  for (const p of props) {
    assertEquals((CARD_SCHEMA.properties as Record<string, { nullable?: boolean }>)[p].nullable, true);
  }
});

Deno.test("parseGeminiCard: happy path returns the parsed card object", () => {
  const card = { name: "김철수", gender: "남", pastoralVisitRequested: true };
  const resp = { candidates: [{ content: { parts: [{ text: JSON.stringify(card) }] } }] };
  assertEquals(parseGeminiCard(resp), card);
});

Deno.test("parseGeminiCard: null on missing/blocked/non-JSON/non-object responses", () => {
  assertEquals(parseGeminiCard(null), null);
  assertEquals(parseGeminiCard("nope"), null);
  assertEquals(parseGeminiCard({}), null);
  assertEquals(parseGeminiCard({ candidates: [] }), null);
  assertEquals(parseGeminiCard({ candidates: [{ content: { parts: [] } }] }), null);
  assertEquals(parseGeminiCard({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), null);
  assertEquals(parseGeminiCard({ candidates: [{ content: { parts: [{ text: "[1,2]" }] } }] }), null);
  assertEquals(
    parseGeminiCard({
      promptFeedback: { blockReason: "SAFETY" },
      candidates: [{ content: { parts: [{ text: "{}" }] } }],
    }),
    null,
  );
});
