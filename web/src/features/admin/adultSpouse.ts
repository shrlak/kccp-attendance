import { ADULT_GROUP } from '../../lib/partition'
import { birthRaw, isoDateOrNull, packFamily, type AdultCardValue, type AdultFamilyMember } from './adultCard'
import type { NewMemberFields } from '../../lib/api'

// ── 카드 한 장에 부부가 적혀 있으면 두 사람으로 등록한다 ──────────────────────────────
//
// 장년부 카드는 **세대 단위**다: 본인 칸을 채우고, 동행가족 표에 배우자와 자녀를 적는다.
// 자녀는 출석을 찍지 않으므로 그 표(`members.family`) 안에 남는 것으로 충분하지만,
// **배우자는 자기 출석을 찍는다** — 주일마다 키오스크 앞에 서는 사람이 둘인데 명단에 한
// 명뿐이면, 나머지 한 사람은 이름을 찾지 못해 손님으로 찍히거나 아예 안 찍힌다.
// 그래서 관계 칸이 배우자를 가리키는 줄은 **멤버 행을 따로 하나 더** 만든다.
//
// 이건 새로 정한 규칙이 아니라 스키마가 처음부터 예상해 둔 모양이다 (마이그레이션
// 20260808): "부부는 각자 출석을 찍어야 하므로 멤버 행이 둘이지만, 주소·전화·자녀는 한
// 세대의 것이다" — 그 둘을 묶는 값이 `household_id`이고, 여기서 그 값을 만들어 양쪽에
// 같이 실어 보낸다.
//
// **세대의 것과 사람의 것을 가른다**: 주소·집 전화·참석동기·교회등록 의사·방문 일자·등록일과
// 동행가족 표는 카드 한 장의 사실이므로 그대로 복사하고, 이름·영문 이름·성별·생년월일·
// 세례여부는 그 줄에 적힌 그 사람의 것으로 채운다. 복사하지 않는 것이 둘 있다:
//   · **교우 등록번호** — 한 사람에게 발급된 번호라, 같은 값을 둘이 들면 그 번호로 사람을
//     찾을 수 없게 된다.
//   · **직장 또는 학교명** — 카드에 한 칸뿐이고 그건 본인 것이다.
// 휴대폰은 복사한다. 카드에 번호가 하나뿐이므로 그 번호가 세대의 유일한 연결 고리이고,
// 없는 것보다 (고칠 수 있는) 같은 번호가 낫다.

// 관계 칸에 실제로 적히는 말들. 종이의 자유 기입 칸이라 사람마다 다르게 쓴다 — 한글로
// 적는 사람, 영어로 적는 사람, '배우자(妻)'처럼 덧붙이는 사람이 다 있으므로 **포함**으로
// 본다. 'Spouse' / 'HUSBAND' / 'wife' 같은 대소문자 차이는 소문자로 눌러 흡수한다.
const SPOUSE_WORDS = [
  '배우자',
  '남편',
  '아내',
  '부인',
  '와이프',
  '처',
  'spouse',
  'husband',
  'wife',
]

// '자녀'·'아들'·'딸'은 배우자가 아니다. '처남'·'처제'·'처형'처럼 '처'로 시작하는 인척도
// 배우자가 아닌데, '처' 한 글자를 포함으로 보면 전부 걸린다 — 그래서 그 말들만 먼저
// 걷어낸다. (반대 방향으로 틀리는 편이 낫다: 배우자를 놓치면 사람이 한 명 빠지지만,
// 처남을 배우자로 읽으면 있지도 않은 부부가 명단에 생긴다.)
const NOT_SPOUSE = ['처남', '처제', '처형', '처가', '처부', '처모']

export function isSpouseRelation(relation: string): boolean {
  const s = (relation || '').trim().toLowerCase()
  if (!s) return false
  if (NOT_SPOUSE.some((w) => s.includes(w))) return false
  return SPOUSE_WORDS.some((w) => s.includes(w))
}

// 카드에 적힌 배우자 줄들. 이름이 하나도 없는 줄은 종이의 빈 칸이므로 세지 않는다 —
// 이름이 없으면 명단에 올릴 사람이 없다.
export function spouseRows(family: AdultFamilyMember[]): AdultFamilyMember[] {
  return (family || []).filter((row) => isSpouseRelation(row.relation) && spouseName(row) !== '')
}

// 한글 이름이 먼저, 없으면 영문. 명단의 이름은 한글이 기본이지만 영문만 적힌 카드도 있고,
// 그때 빈 이름으로 두면 그 사람을 어디에서도 찾을 수 없다.
export function spouseName(row: AdultFamilyMember): string {
  return (row.nameKo || '').trim() || (row.nameEn || '').trim()
}

// 성별은 이 시스템에서 '남'/'여' 두 말로만 적힌다 (출석부 엑셀의 칸 색도, 멤버 편집 창의
// 선택지도 그 말만 안다). 그런데 동행가족 표의 성별은 카드 판독이 'M'/'F'로 적어 오는 일이
// 있어서 — 종이에 영문 이름을 쓴 카드가 그렇다 — 그대로 옮기면 아무도 읽지 못하는 값이
// 명단에 들어간다. **표기를 옮기는 것뿐이라 없던 사실을 지어내지 않는다**; 모르는 값은
// 적힌 그대로 둔다 (지우면 그 칸에 뭐라고 적혀 있었는지가 사라진다).
export function normalizeGender(value: string): string {
  const s = (value || '').trim()
  const u = s.toUpperCase()
  if (u === 'M' || u === 'MALE') return '남'
  if (u === 'F' || u === 'FEMALE') return '여'
  return s
}

// 같은 카드로 등록된 사람들을 묶는 값. crypto.randomUUID가 없는 오래된 브라우저에서도
// 등록 자체는 돌아야 하므로 빈 문자열로 떨어뜨린다 (서버가 그 값을 버린다) — 세대 묶음이
// 없는 등록은 예전과 같은 등록이고, 등록이 안 되는 것보다 낫다.
export function newHouseholdId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return ''
  }
}

// 배우자 줄 → 등록 몸통. 세대의 값은 카드에서, 사람의 값은 그 줄에서 온다.
export function spousePayload(
  card: AdultCardValue,
  row: AdultFamilyMember,
  householdId = '',
): NewMemberFields {
  return {
    name: spouseName(row),
    group: ADULT_GROUP,
    subgroup: '',
    // ── 그 사람의 것 ──
    gender: normalizeGender(row.gender),
    birthDate: isoDateOrNull(row.birthDate),
    birthDateRaw: birthRaw(row.birthDate),
    baptismStatus: (row.baptism || '').trim(),
    nameEn: (row.nameEn || '').trim(),
    // ── 한 세대의 것 ──
    phone: card.phone.trim(),
    phoneHome: card.phoneHome.trim(),
    email: card.email.trim(),
    address: card.address.trim(),
    city: card.city.trim(),
    state: card.state.trim(),
    zipCode: card.zipCode.trim(),
    attendReason: card.attendReason,
    registrationChoice: card.registrationChoice,
    visitDate: isoDateOrNull(card.visitDate),
    registrationDate: isoDateOrNull(card.registrationDate),
    // 동행가족 표는 카드 한 장의 사실이라 양쪽이 같은 목록을 든다 (본인이 배우자의
    // 동행가족이기도 하다는 것을, 한 장뿐인 종이는 따로 적지 않는다).
    family: packFamily(card.family),
    householdId,
  }
}
