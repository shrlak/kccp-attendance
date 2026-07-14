// Ported from supabase/functions/attendance-api/gemini.test.ts (Deno) — pure logic,
// no runtime-specific APIs, so the assertions translate 1:1.
import { describe, expect, it } from "vitest";
import { buildGeminiBody, parseGeminiCard, CARD_PROMPT, CARD_SCHEMA } from "../src/lib/gemini";

describe("buildGeminiBody", () => {
  it("puts the image part first, prompt second, and sets structured-output config", () => {
    const b = buildGeminiBody("QUJD", "image/jpeg");
    expect(b.contents.length).toBe(1);
    const parts = b.contents[0].parts;
    expect(parts[0]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
    expect(parts[1]).toEqual({ text: CARD_PROMPT });
    expect(b.generationConfig.temperature).toBe(0);
    expect(b.generationConfig.responseMimeType).toBe("application/json");
    expect(b.generationConfig.responseSchema).toEqual(CARD_SCHEMA);
  });
});

describe("CARD_SCHEMA", () => {
  it("every property is nullable and required (null = illegible, not omitted)", () => {
    const props = Object.keys(CARD_SCHEMA.properties);
    expect(props.length).toBe(11);
    expect([...CARD_SCHEMA.required].sort()).toEqual([...props].sort());
    for (const p of props) {
      expect((CARD_SCHEMA.properties as Record<string, { nullable?: boolean }>)[p].nullable).toBe(true);
    }
  });
});

describe("parseGeminiCard", () => {
  it("happy path returns the parsed card object", () => {
    const card = { name: "김철수", gender: "남", pastoralVisitRequested: true };
    const resp = { candidates: [{ content: { parts: [{ text: JSON.stringify(card) }] } }] };
    expect(parseGeminiCard(resp)).toEqual(card);
  });

  it("returns null on missing/blocked/non-JSON/non-object responses", () => {
    expect(parseGeminiCard(null)).toBeNull();
    expect(parseGeminiCard("nope")).toBeNull();
    expect(parseGeminiCard({})).toBeNull();
    expect(parseGeminiCard({ candidates: [] })).toBeNull();
    expect(parseGeminiCard({ candidates: [{ content: { parts: [] } }] })).toBeNull();
    expect(parseGeminiCard({ candidates: [{ content: { parts: [{ text: "not json" }] } }] })).toBeNull();
    expect(parseGeminiCard({ candidates: [{ content: { parts: [{ text: "[1,2]" }] } }] })).toBeNull();
    expect(
      parseGeminiCard({
        promptFeedback: { blockReason: "SAFETY" },
        candidates: [{ content: { parts: [{ text: "{}" }] } }],
      }),
    ).toBeNull();
  });
});
