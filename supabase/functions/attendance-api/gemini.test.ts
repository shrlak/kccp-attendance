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
  CARD_PROMPT_ADULT,
  CARD_PROMPT_FREEFORM,
  CARD_SCHEMA,
  CARDS_SCHEMA,
  cardModelChain,
  hasGen3Options,
  isGen3Model,
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

Deno.test("buildGeminiBody: Gemini 3 drops temperature and turns the image up", () => {
  const cfg = buildGeminiBody("QUJD", "image/jpeg", undefined, "gemini-3.6-flash").generationConfig;
  // 여러 장이 한 프레임에 들어온 사진에서 손글씨가 뭉개지지 않게.
  assertEquals(cfg.media_resolution, "MEDIA_RESOLUTION_HIGH");
  // 20초 예산 안에 답이 오도록.
  assertEquals(cfg.thinking_level, "low");
  // temperature/top_p/top_k는 이 세대에서 물러났다 — 보내지 않는다.
  assertEquals("temperature" in cfg, false);
  assertEquals(cfg.responseSchema, CARDS_SCHEMA);

  // plain: 그 두 다이얼을 모르는 배포가 400을 줄 때 한 번 더 두드리는 몸통.
  const plain = buildGeminiBody("QUJD", "image/jpeg", undefined, "gemini-3.6-flash", true).generationConfig;
  assertEquals("media_resolution" in plain, false);
  assertEquals("thinking_level" in plain, false);
  assertEquals("temperature" in plain, false);
  assertEquals(plain.responseSchema, CARDS_SCHEMA);

  // 2.x는 그대로 temperature 0.
  const gen2 = buildGeminiBody("QUJD", "image/jpeg", undefined, "gemini-2.5-flash").generationConfig;
  assertEquals(gen2.temperature, 0);
  assertEquals("thinking_level" in gen2, false);
});

Deno.test("isGen3Model/hasGen3Options: the generation number decides, OpenRouter never", () => {
  assertEquals(isGen3Model("gemini-3.6-flash"), true);
  assertEquals(isGen3Model("gemini-3.5-flash-lite"), true);
  assertEquals(isGen3Model("gemini-4.0-flash"), true);
  assertEquals(isGen3Model("gemini-2.5-flash"), false);
  assertEquals(isGen3Model("gemini-2.0-flash-lite"), false);
  assertEquals(isGen3Model("google/gemma-3-27b-it:free"), false);
  assertEquals(hasGen3Options(cardModelChain("gemini-3.6-flash")[0]), true);
  assertEquals(hasGen3Options(cardModelChain("gemini-2.5-flash")[0]), false);
  // A "vendor/model" id is OpenRouter's, which has neither knob.
  assertEquals(hasGen3Options(cardModelChain("vendor/gemini-3-vl:free")[0]), false);
});

Deno.test("한 사진 여러 장: the prompt makes the array length the card count", () => {
  // 배열 길이 = 장수. 이 두 문장이 없으면 모델이 겹쳐 놓은 카드를 한 장으로 합친다.
  assertEquals(CARD_PROMPT.includes("배열의 길이를 그 장수와 똑같이"), true);
  assertEquals(CARD_PROMPT.includes("한 장을 두 개의 객체로 쪼개지 말고, 두 장을 한 객체에 합치지도 마세요."), true);
  // 동행가족은 카드가 아니다 — 장년부 카드 한 장이 네 명으로 불어나지 않도록.
  assertEquals(CARD_PROMPT.includes("동행가족은 카드가 아닙니다"), true);
  // 관계 칸은 배우자를 가려내는 열쇠다 (웹의 adultSpouse.ts가 이 글자를 읽는다). 모델이
  // '아내'를 '가족'으로 고쳐 쓰면 배우자가 명단에 올라가지 않는다.
  assertEquals(CARD_PROMPT.includes("관계 칸(relation)은 **적힌 그대로** 옮기세요"), true);
  assertEquals(CARD_PROMPT_ADULT.includes("관계 칸(relation)은 **적힌 그대로** 옮기세요"), true);
  // 같은 규칙이 스키마 없는 모델(OpenRouter)에도 그대로 간다.
  assertEquals(CARD_PROMPT_FREEFORM.includes("배열의 길이를 그 장수와 똑같이"), true);
});

Deno.test("심방 요청: an unmarked O/X box must read as null, never false", () => {
  const visit = CARD_SCHEMA.properties.pastoralVisitRequested as { description?: string };
  assertEquals(visit.description, "O 표시=true, X 표시=false, 아무 표시 없음=null");
  // The same rule in the prompt, so the freeform (OpenRouter) path follows it too.
  assertEquals(CARD_PROMPT.includes("표시가 없으면 반드시 null"), true);
  assertEquals(CARD_PROMPT_FREEFORM.includes("표시가 없으면 반드시 null"), true);
});

Deno.test("CARD_SCHEMA: every property is nullable and the youth-card fields are required", () => {
  const props = Object.keys(CARD_SCHEMA.properties);
  const required = [
    "cardType",
    "name",
    "gender",
    "phone",
    "kakaoId",
    "birthDate",
    "affiliationCategory",
    "affiliationDetail",
    "baptismStatus",
    "faithDuration",
    "registrationDate",
    "pastoralVisitRequested",
  ];
  assertEquals([...CARD_SCHEMA.required].sort(), required.sort());
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

Deno.test("parseGeminiCards: a thought part is not part of the answer", () => {
  const resp = {
    candidates: [{
      content: {
        parts: [
          { text: "카드 두 장이 보입니다. 왼쪽부터 읽겠습니다.", thought: true },
          { text: '[{"name":"김철수"},{"name":"이영희"}]' },
        ],
      },
    }],
  };
  assertEquals(parseGeminiCards(resp), [{ name: "김철수" }, { name: "이영희" }]);
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
  // Gemini 3.6 Flash leads: free tier, structured output, and the generation that can
  // actually read handwriting when a photo holds several cards at once.
  assertEquals(CARD_MODELS[0].id, "gemini-3.6-flash");
  // The 2.x line stays below it — a bad day on the new model is a slower read, not a
  // failed one — and it must still be inside the attempt window (4).
  assertEquals(CARD_MODELS.slice(0, 4).some((m) => m.id === "gemini-2.5-flash"), true);
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
  assertEquals(google.body, buildGeminiBody("QUJD", "image/jpeg", undefined, "gemini-2.0-flash"));

  // The chain head carries its generation's config, and `plain` is the retry body.
  const gen3 = buildCardRequest(cardModelChain("gemini-3.6-flash")[0], "QUJD", "image/jpeg", "gk");
  assertEquals(gen3.url.includes("/models/gemini-3.6-flash:generateContent"), true);
  assertEquals(gen3.body, buildGeminiBody("QUJD", "image/jpeg", undefined, "gemini-3.6-flash"));
  const retry = buildCardRequest(cardModelChain("gemini-3.6-flash")[0], "QUJD", "image/jpeg", "gk", undefined, true);
  assertEquals(retry.body, buildGeminiBody("QUJD", "image/jpeg", undefined, "gemini-3.6-flash", true));

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
