// ── Gemini card extraction — pure request/response plumbing ──────────────────
// Shapes the generateContent request and parses the response for the 새가족
// 등록 카드 photo-extraction endpoint (/api/admin/extract-card). Pure only — no
// fetch, no runtime-specific APIs — so it stays unit-testable. Ported verbatim
// from supabase/functions/attendance-api/gemini.ts (already portable).
// The enum vocabulary below must match web/src/features/admin/newFamilyCard.ts
// exactly: the client clamps against those same constants after extraction.

export const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Korean prompt describing the paper card's layout and reading rules.
export const CARD_PROMPT = [
  "이 이미지는 'KCCP 빛주사랑 대학청년부 새가족 등록 카드'입니다 (손글씨 한국어/영어).",
  "표의 각 칸을 읽어 JSON으로 추출하세요. 규칙:",
  "1. 이름 칸의 ( 남 / 여 ) 중 동그라미·표시된 쪽이 gender입니다.",
  "2. 체크박스 항목(소속, 세례 여부, 신앙생활)은 체크·동그라미된 항목의 라벨 하나만 고르세요.",
  "3. 날짜(생년월일, 등록일)는 YYYY-MM-DD로 변환하세요. 카드에는 MM / DD / YYYY 순서로 적혀 있습니다.",
  "   두 자리 연도는 생년월일이면 19xx/20xx 중 자연스러운 쪽으로, 등록일이면 20xx로 해석하세요.",
  "4. 전화번호는 적힌 숫자 그대로 옮기세요 (하이픈 등 구분 기호 포함 가능).",
  "5. '목사님 심방 요청'은 O에 표시되어 있으면 true, X에 표시되어 있으면 false입니다.",
  "6. 비어 있거나 판독할 수 없는 칸은 null로 두세요. 절대 추측하지 마세요.",
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

// generateContent request body: image part first, prompt second; temperature 0 +
// responseSchema for deterministic, directly parseable JSON.
export function buildGeminiBody(image: string, mediaType: string) {
  return {
    contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: image } }, { text: CARD_PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: CARD_SCHEMA },
  };
}

// Pull the structured JSON object out of a generateContent response. Null on
// anything unexpected (no candidates, safety block, non-JSON text, non-object) —
// the endpoint maps null to a clear 502.
export function parseGeminiCard(resp: unknown): Record<string, unknown> | null {
  if (!resp || typeof resp !== "object") return null;
  const r = resp as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (r.promptFeedback?.blockReason) return null;
  const text = r.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
