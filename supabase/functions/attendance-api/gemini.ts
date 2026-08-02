// ── 카드 사진 인식 모델 — pure request/response plumbing ──────────────────────
// Shapes the vision request and parses the response for the 새가족 등록 카드
// photo-extraction endpoint (/api/admin/extract-card). Pure only — no fetch, no
// Deno APIs — so it stays unit-testable (gemini.test.ts) like auth.ts.
// The enum vocabulary below must match web/src/features/admin/newFamilyCard.ts
// exactly: the client clamps against those same constants after extraction.
//
// Handwritten Korean+English is hard, and every model here is on a free tier, so a
// single request walks a chain of models (CARD_MODELS) until one returns readable
// cards: a model that is rate-limited, unavailable, times out, or answers with
// nothing parseable simply hands off to the next one.

// Google AI Studio (free tier) — key: GEMINI_API_KEY.
const GOOGLE_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
// OpenRouter's `:free` model pool — key: OPENROUTER_API_KEY. Optional: with no key
// configured these entries are skipped and the chain is Google-only.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Kept for callers/tests that referenced the original single-model endpoint.
export const GEMINI_URL = GOOGLE_URL("gemini-2.5-flash");

export type CardProvider = "google" | "openrouter";

export interface CardModel {
  id: string; // stable key used in CARD_MODEL_CHAIN and the audit detail
  label: string; // shown to the admin next to the extracted card
  provider: CardProvider;
  model: string; // provider-side model id
}

// Free-tier vision models that can read handwriting, best-first. Google's structured
// output makes gemini-2.5-flash the reliable default; the rest are fallbacks for when
// it is rate-limited or returns nothing. Model ids come and go on the free pool, so
// the chain is overridable at runtime with the CARD_MODEL_CHAIN env var (comma-
// separated ids) — no code deploy needed to drop a retired model.
export const CARD_MODELS: CardModel[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", model: "gemini-2.5-flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", model: "gemini-2.5-pro" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "google", model: "gemini-2.0-flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: "google", model: "gemini-2.5-flash-lite" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", provider: "google", model: "gemini-2.0-flash-lite" },
  { id: "qwen2.5-vl-72b", label: "Qwen2.5-VL 72B", provider: "openrouter", model: "qwen/qwen2.5-vl-72b-instruct:free" },
  { id: "qwen2.5-vl-32b", label: "Qwen2.5-VL 32B", provider: "openrouter", model: "qwen/qwen2.5-vl-32b-instruct:free" },
  { id: "mistral-small-3.2", label: "Mistral Small 3.2", provider: "openrouter", model: "mistralai/mistral-small-3.2-24b-instruct:free" },
  { id: "gemma-3-27b", label: "Gemma 3 27B", provider: "openrouter", model: "google/gemma-3-27b-it:free" },
  { id: "gemma-3-12b", label: "Gemma 3 12B", provider: "openrouter", model: "google/gemma-3-12b-it:free" },
  { id: "llama-3.2-11b-vision", label: "Llama 3.2 11B Vision", provider: "openrouter", model: "meta-llama/llama-3.2-11b-vision-instruct:free" },
  { id: "kimi-vl-a3b", label: "Kimi VL A3B", provider: "openrouter", model: "moonshotai/kimi-vl-a3b-thinking:free" },
];

// Korean prompt describing the paper card's layout and reading rules. One photo may
// hold several cards (a stack laid out on a table, two cards side by side), so the
// answer is always an array — one object per card.
export const CARD_PROMPT = [
  "이 이미지에는 'KCCP 빛주사랑 대학청년부 새가족 등록 카드'가 한 장 이상 찍혀 있습니다 (손글씨 한국어/영어).",
  "사진 속 카드를 모두 찾아 각 카드마다 JSON 객체 하나를 만들고, 배열로 반환하세요. 규칙:",
  "1. 이름 칸의 ( 남 / 여 ) 중 동그라미·표시된 쪽이 gender입니다.",
  "2. 체크박스 항목(소속, 세례 여부, 신앙생활)은 체크·동그라미된 항목의 라벨 하나만 고르세요.",
  "3. 날짜(생년월일, 등록일)는 YYYY-MM-DD로 변환하세요. 카드에는 MM / DD / YYYY 순서로 적혀 있습니다.",
  "   두 자리 연도는 생년월일이면 19xx/20xx 중 자연스러운 쪽으로, 등록일이면 20xx로 해석하세요.",
  "4. 전화번호는 적힌 숫자 그대로 옮기세요 (하이픈 등 구분 기호 포함 가능).",
  "5. '목사님 심방 요청'은 O에 표시되어 있으면 true, X에 표시되어 있으면 false입니다.",
  "6. 비어 있거나 판독할 수 없는 칸은 null로 두세요. 절대 추측하지 마세요.",
  "7. 카드가 여러 장이면 사진 속 위치 순서(위→아래, 왼쪽→오른쪽)로 배열에 담으세요.",
  "   카드끼리 내용을 섞지 말고, 각 카드는 그 카드에 적힌 값만으로 채우세요.",
  "   카드가 한 장이면 원소가 하나인 배열을 반환하세요.",
  "8. 일부만 보이거나 기울어진 카드도 칸을 읽을 수 있으면 포함하고, 보이지 않는 칸은 null로 두세요.",
  "   카드가 아닌 배경·빈 종이·중복 촬영본은 배열에 넣지 마세요.",
].join("\n");

// Structured-output schema (Gemini's OpenAPI subset — uppercase types). Every
// field nullable: null means "blank or illegible", never a guess.
export const CARD_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", nullable: true },
    gender: { type: "STRING", enum: ["남", "여"], nullable: true },
    phone: { type: "STRING", nullable: true },
    kakaoId: { type: "STRING", nullable: true },
    birthDate: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    affiliationCategory: { type: "STRING", enum: ["대학생", "대학원생", "직장인", "Other"], nullable: true },
    affiliationDetail: { type: "STRING", nullable: true, description: "학교/전공 or 직장" },
    baptismStatus: { type: "STRING", enum: ["유아세례", "입교", "세례", "해당없음"], nullable: true },
    faithDuration: { type: "STRING", enum: ["모태신앙", "1년 미만", "1-3년", "3-5년", "5년 이상"], nullable: true },
    registrationDate: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    pastoralVisitRequested: { type: "BOOLEAN", nullable: true },
  },
  required: [
    "name", "gender", "phone", "kakaoId", "birthDate", "affiliationCategory",
    "affiliationDetail", "baptismStatus", "faithDuration", "registrationDate",
    "pastoralVisitRequested",
  ],
};

// One photo → one card object per card visible in it. A single card is an array of one,
// so the endpoint has exactly one response shape to handle.
export const CARDS_SCHEMA = { type: "ARRAY", items: CARD_SCHEMA, minItems: 1 };

// Models without server-side schema enforcement (the OpenRouter pool) get the shape
// spelled out in the prompt instead, plus the same enum vocabulary.
const SCHEMA_HINT = [
  "",
  "출력은 오직 JSON 배열 하나입니다. 설명·주석·마크다운 코드펜스를 쓰지 마세요.",
  "각 원소는 다음 키를 모두 가진 객체입니다 (값이 없으면 null):",
  '{"name":string|null,"gender":"남"|"여"|null,"phone":string|null,"kakaoId":string|null,' +
    '"birthDate":"YYYY-MM-DD"|null,"affiliationCategory":"대학생"|"대학원생"|"직장인"|"Other"|null,' +
    '"affiliationDetail":string|null,"baptismStatus":"유아세례"|"입교"|"세례"|"해당없음"|null,' +
    '"faithDuration":"모태신앙"|"1년 미만"|"1-3년"|"3-5년"|"5년 이상"|null,' +
    '"registrationDate":"YYYY-MM-DD"|null,"pastoralVisitRequested":true|false|null}',
].join("\n");

export const CARD_PROMPT_FREEFORM = CARD_PROMPT + "\n" + SCHEMA_HINT;

// Resolve the model chain to walk for one request. `spec` is the CARD_MODEL_CHAIN env
// var: comma-separated CARD_MODELS ids, or raw provider model ids for anything not in
// the table (a "vendor/model" id is OpenRouter's, everything else Google's) so a newly
// released free model can be slotted in without a deploy. Empty/blank → CARD_MODELS.
export function cardModelChain(spec?: string | null): CardModel[] {
  const ids = (spec || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return CARD_MODELS;
  return ids.map((id) => {
    const known = CARD_MODELS.find((m) => m.id === id || m.model === id);
    if (known) return known;
    const provider: CardProvider = id.includes("/") ? "openrouter" : "google";
    return { id, label: id, provider, model: id };
  });
}

// Only models whose provider key is configured can be called. Keeps the chain honest
// when OPENROUTER_API_KEY is unset (the default) — those entries are simply skipped.
export function availableCardModels(chain: CardModel[], keys: Partial<Record<CardProvider, string>>): CardModel[] {
  return chain.filter((m) => Boolean(keys[m.provider]));
}

// The HTTP call for one model: url + headers + body, ready for fetch().
export function buildCardRequest(
  model: CardModel,
  image: string,
  mediaType: string,
  apiKey: string,
): { url: string; headers: Record<string, string>; body: unknown } {
  if (model.provider === "openrouter") {
    return {
      url: OPENROUTER_URL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attribution headers — optional, but they keep free-tier requests
        // identifiable rather than anonymous.
        "HTTP-Referer": "https://shrlak.github.io/kccp-attendance/",
        "X-Title": "KCCP Attendance",
      },
      body: {
        model: model.model,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } },
            { type: "text", text: CARD_PROMPT_FREEFORM },
          ],
        }],
      },
    };
  }
  return {
    url: GOOGLE_URL(model.model),
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: buildGeminiBody(image, mediaType),
  };
}

// generateContent request body: image part first, prompt second; temperature 0 +
// responseSchema for deterministic, directly parseable JSON.
export function buildGeminiBody(image: string, mediaType: string) {
  return {
    contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text: CARD_PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: CARDS_SCHEMA },
  };
}

// Provider response → list of cards. Null when the model gave nothing usable, which
// is the endpoint's signal to try the next model in the chain.
export function parseCardResponse(model: CardModel, resp: unknown): Record<string, unknown>[] | null {
  return model.provider === "openrouter" ? parseOpenRouterCards(resp) : parseGeminiCards(resp);
}

// Pull the structured JSON out of a generateContent response as a list of cards.
// A bare object (model ignored the array schema) is accepted as a one-card list;
// null on anything unexpected (no candidates, safety block, non-JSON text, empty
// list, no object entries).
export function parseGeminiCards(resp: unknown): Record<string, unknown>[] | null {
  if (!resp || typeof resp !== "object") return null;
  const r = resp as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (r.promptFeedback?.blockReason) return null;
  const parts = r.candidates?.[0]?.content?.parts;
  const text = parts?.map((p) => p?.text).filter((t) => typeof t === "string").join("") || "";
  return cardsFromText(text);
}

// OpenAI-shaped chat completion (OpenRouter). These models answer in prose-adjacent
// JSON — code fences, a preamble — so the text goes through the lenient extractor.
export function parseOpenRouterCards(resp: unknown): Record<string, unknown>[] | null {
  if (!resp || typeof resp !== "object") return null;
  const r = resp as { choices?: { message?: { content?: unknown } }[]; error?: unknown };
  if (r.error) return null;
  const content = r.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    // Some models answer with the multi-part content array instead of a string.
    : Array.isArray(content)
    ? content.map((c) => (c && typeof c === "object" ? (c as { text?: string }).text : "")).filter(Boolean).join("")
    : "";
  return cardsFromText(text);
}

// Text → card list. Parses the whole string first (what a structured-output model
// returns), then falls back to the first JSON array/object embedded in it, so a
// ```json fence or a chatty preamble doesn't cost a whole extraction.
export function cardsFromText(text: unknown): Record<string, unknown>[] | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  for (const candidate of [stripped, sliceJson(stripped, "[", "]"), sliceJson(stripped, "{", "}")]) {
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const cards = list.filter(
      (c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c),
    );
    if (cards.length) return cards;
  }
  return null;
}

// First balanced-looking JSON span between `open` and its last matching `close`.
function sliceJson(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}
