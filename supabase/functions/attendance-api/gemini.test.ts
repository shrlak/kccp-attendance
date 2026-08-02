// Run with: deno test supabase/functions/attendance-api/gemini.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import {
  availableCardModels,
  buildCardRequest,
  buildGeminiBody,
  CARD_MODELS,
  CARD_PROMPT,
  CARD_PROMPT_FREEFORM,
  CARD_SCHEMA,
  CARDS_SCHEMA,
  cardModelChain,
  parseCardResponse,
  parseGeminiCards,
  parseOpenRouterCards,
} from "./gemini.ts";

Deno.test("buildGeminiBody: image part first, prompt second, structured-output config", () => {
  const b = buildGeminiBody("QUJD", "image/jpeg");
  assertEquals(b.contents.length, 1);
  const parts = b.contents[0].parts;
  assertEquals(parts[0], { inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
  assertEquals(parts[1], { text: CARD_PROMPT });
  assertEquals(b.generationConfig.temperature, 0);
  assertEquals(b.generationConfig.responseMimeType, "application/json");
  // A list of cards, so one photo of a stack yields every card on it.
  assertEquals(b.generationConfig.responseSchema, CARDS_SCHEMA);
  assertEquals(CARDS_SCHEMA.items, CARD_SCHEMA);
});

Deno.test("CARD_SCHEMA: every property is nullable and required (null = illegible, not omitted)", () => {
  const props = Object.keys(CARD_SCHEMA.properties);
  assertEquals(props.length, 11);
  assertEquals([...CARD_SCHEMA.required].sort(), [...props].sort());
  for (const p of props) {
    assertEquals((CARD_SCHEMA.properties as Record<string, { nullable?: boolean }>)[p].nullable, true);
  }
});

const respond = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

Deno.test("parseGeminiCards: returns every card the photo contained, in order", () => {
  const cards = [
    { name: "김철수", gender: "남", pastoralVisitRequested: true },
    { name: "이영희", gender: "여", pastoralVisitRequested: null },
  ];
  assertEquals(parseGeminiCards(respond(JSON.stringify(cards))), cards);
});

Deno.test("parseGeminiCards: a bare object is read as a one-card list", () => {
  const card = { name: "김철수", gender: "남" };
  assertEquals(parseGeminiCards(respond(JSON.stringify(card))), [card]);
});

Deno.test("parseGeminiCards: non-object entries are dropped, not returned as cards", () => {
  assertEquals(parseGeminiCards(respond('[1, null, {"name":"김철수"}, "x"]')), [{ name: "김철수" }]);
});

Deno.test("parseGeminiCards: null on missing/blocked/non-JSON/empty responses", () => {
  assertEquals(parseGeminiCards(null), null);
  assertEquals(parseGeminiCards("nope"), null);
  assertEquals(parseGeminiCards({}), null);
  assertEquals(parseGeminiCards({ candidates: [] }), null);
  assertEquals(parseGeminiCards({ candidates: [{ content: { parts: [] } }] }), null);
  assertEquals(parseGeminiCards(respond("not json")), null);
  assertEquals(parseGeminiCards(respond("[]")), null);
  assertEquals(parseGeminiCards(respond("[1,2]")), null);
  assertEquals(
    parseGeminiCards({
      promptFeedback: { blockReason: "SAFETY" },
      candidates: [{ content: { parts: [{ text: "[{}]" }] } }],
    }),
    null,
  );
});

Deno.test("CARD_MODELS: unique ids, all free-tier providers we have plumbing for", () => {
  const ids = CARD_MODELS.map((m) => m.id);
  assertEquals(new Set(ids).size, ids.length);
  for (const m of CARD_MODELS) {
    assertEquals(["google", "openrouter"].includes(m.provider), true);
    // OpenRouter's free pool is the `:free` suffix — a paid id here would bill the key.
    if (m.provider === "openrouter") assertEquals(m.model.endsWith(":free"), true);
  }
  // Gemini 2.5 Flash stays first: structured output makes it the reliable default.
  assertEquals(CARD_MODELS[0].id, "gemini-2.5-flash");
});

Deno.test("cardModelChain: defaults to the full list, CARD_MODEL_CHAIN overrides it", () => {
  assertEquals(cardModelChain(), CARD_MODELS);
  assertEquals(cardModelChain(""), CARD_MODELS);
  assertEquals(cardModelChain("  "), CARD_MODELS);
  assertEquals(cardModelChain("gemini-2.0-flash, gemini-2.5-flash").map((m) => m.id), [
    "gemini-2.0-flash",
    "gemini-2.5-flash",
  ]);
  // Unknown ids still work so a new free model needs no deploy: a "vendor/model" id is
  // OpenRouter's, a bare one Google's.
  assertEquals(cardModelChain("vendor/new-vl:free")[0], {
    id: "vendor/new-vl:free",
    label: "vendor/new-vl:free",
    provider: "openrouter",
    model: "vendor/new-vl:free",
  });
  assertEquals(cardModelChain("gemini-9.9-flash")[0].provider, "google");
});

Deno.test("availableCardModels: keeps only models whose provider key is configured", () => {
  const chain = cardModelChain("gemini-2.5-flash,qwen2.5-vl-72b");
  assertEquals(availableCardModels(chain, { google: "k" }).map((m) => m.id), ["gemini-2.5-flash"]);
  assertEquals(availableCardModels(chain, { openrouter: "k" }).map((m) => m.id), ["qwen2.5-vl-72b"]);
  assertEquals(availableCardModels(chain, { google: "k", openrouter: "k" }).length, 2);
  assertEquals(availableCardModels(chain, {}).length, 0);
  assertEquals(availableCardModels(chain, { google: "" }).length, 0);
});

Deno.test("buildCardRequest: Google gets generateContent + schema, OpenRouter a chat completion", () => {
  const google = buildCardRequest(cardModelChain("gemini-2.0-flash")[0], "QUJD", "image/jpeg", "gk");
  assertEquals(google.url.includes("/models/gemini-2.0-flash:generateContent"), true);
  assertEquals(google.headers["x-goog-api-key"], "gk");
  assertEquals(google.body, buildGeminiBody("QUJD", "image/jpeg"));

  const or = buildCardRequest(cardModelChain("qwen2.5-vl-72b")[0], "QUJD", "image/jpeg", "ok");
  assertEquals(or.url, "https://openrouter.ai/api/v1/chat/completions");
  assertEquals(or.headers.Authorization, "Bearer ok");
  const body = or.body as {
    model: string;
    temperature: number;
    messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[];
  };
  assertEquals(body.model, "qwen/qwen2.5-vl-72b-instruct:free");
  assertEquals(body.temperature, 0);
  assertEquals(body.messages[0].content[0].image_url?.url, "data:image/jpeg;base64,QUJD");
  // No server-side schema on this pool, so the shape is spelled out in the prompt.
  assertEquals(body.messages[0].content[1].text, CARD_PROMPT_FREEFORM);
  assertEquals(CARD_PROMPT_FREEFORM.startsWith(CARD_PROMPT), true);
});

Deno.test("parseOpenRouterCards: reads fenced/chatty JSON out of a chat completion", () => {
  const reply = (content: unknown) => ({ choices: [{ message: { content } }] });
  const cards = [{ name: "김철수" }, { name: "이영희" }];
  assertEquals(parseOpenRouterCards(reply(JSON.stringify(cards))), cards);
  assertEquals(
    parseOpenRouterCards(reply('카드 2장을 읽었습니다:\n```json\n[{"name":"김철수"},{"name":"이영희"}]\n```')),
    cards,
  );
  // Multi-part content arrays, and a lone object, both land as a card list.
  assertEquals(parseOpenRouterCards(reply([{ type: "text", text: '{"name":"김철수"}' }])), [{ name: "김철수" }]);
  assertEquals(parseOpenRouterCards(reply("죄송하지만 읽을 수 없습니다")), null);
  assertEquals(parseOpenRouterCards({ error: { message: "rate limited" }, choices: [] }), null);
  assertEquals(parseOpenRouterCards(null), null);
});

Deno.test("parseCardResponse: dispatches on the model's provider", () => {
  const [google] = cardModelChain("gemini-2.5-flash");
  const [or] = cardModelChain("qwen2.5-vl-72b");
  assertEquals(parseCardResponse(google, respond('[{"name":"김철수"}]')), [{ name: "김철수" }]);
  assertEquals(parseCardResponse(or, { choices: [{ message: { content: '[{"name":"김철수"}]' } }] }), [
    { name: "김철수" },
  ]);
  // Wrong shape for the provider → null, which tells the endpoint to try the next model.
  assertEquals(parseCardResponse(google, { choices: [{ message: { content: "[{}]" } }] }), null);
});
