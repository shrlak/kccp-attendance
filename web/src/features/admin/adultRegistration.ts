import { ADULT_GROUP } from '../../lib/partition'
import { birthRaw, isoDateOrNull, packFamily, type AdultCardValue } from './adultCard'
import type { NewMemberFields } from '../../lib/api'

// 장년부 카드 → 등록 몸통. 키오스크와 공유 링크가 같은 것을 보낸다 — 두 길이 같은 종이를
// 받으므로 담기는 칸도 같아야 한다.
//
// 부서는 고를 것이 없으므로 언제나 장년부이고, 셀은 나중에 관리자가 배정한다 (키오스크에서
// 셀을 묻지 않는 것은 대학·청년부와 같다).
//
// `householdId`는 같은 카드로 함께 등록되는 사람들(부부)을 묶는 값이다 — 배우자 줄이 없는
// 보통의 카드에서는 빈 문자열이고, 그때 서버는 그 칸을 쓰지 않는다. 규칙은 adultSpouse.ts.
//
// **이메일이 비면 그 칸을 아예 보내지 않는다.** `adult.members`의 `members_lower_idx`는
// `lower(email)`에 걸린 유니크 인덱스이고 **빈 문자열도 그 인덱스에 들어간다** — 이메일을
// 적지 않은 사람이 둘이 되는 순간 두 번째 등록이 통째로 거절되고, 화면에는 이유를 알 수 없는
// "Could not create member"만 남는다. 종이 카드의 이메일 칸은 자주 비어 있으므로 그대로 두면
// 등록이 사실상 한 번밖에 되지 않는다. 보내지 않으면 열이 NULL로 남고, NULL은 그 인덱스
// 밖이다 — 배우자 등록이 이미 쓰던 규칙 그대로다 (adultSpouse.ts `spousePayload`).
// 서버도 같은 규칙을 자기 쪽에 두고 있지만(빈 칸 → NULL), 오래된 화면이 남아 있을 수 있어
// 양쪽에 둔다.
export function adultPayload(card: AdultCardValue, householdId = ''): NewMemberFields {
  const email = card.email.trim()
  return {
    householdId,
    name: card.name.trim(),
    group: ADULT_GROUP,
    subgroup: '',
    gender: card.gender,
    phone: card.phone.trim(),
    birthDate: isoDateOrNull(card.birthDate),
    birthDateRaw: birthRaw(card.birthDate),
    baptismStatus: card.baptismStatus,
    schoolOrWork: card.schoolOrWork.trim(),
    registrationDate: isoDateOrNull(card.registrationDate),
    nameEn: card.nameEn.trim(),
    phoneHome: card.phoneHome.trim(),
    ...(email ? { email } : {}),
    address: card.address.trim(),
    city: card.city.trim(),
    state: card.state.trim(),
    zipCode: card.zipCode.trim(),
    attendReason: card.attendReason,
    registrationChoice: card.registrationChoice,
    visitDate: isoDateOrNull(card.visitDate),
    memberNo: card.memberNo.trim(),
    family: packFamily(card.family),
  }
}
