import type { InputHTMLAttributes } from 'react'
import {
  ADULT_CARD_TITLE,
  ATTEND_REASONS,
  REGISTRATION_CHOICES,
  blankFamilyMember,
  type AdultCardValue,
  type AdultFamilyMember,
} from './adultCard'
import { formatPhoneNumber } from '../../lib/phone'

// ── 장년부 새교우 방문 · 등록 카드 — 종이를 그대로 옮긴 입력 양식 ──────────────────────
// 대학·청년부의 NewFamilyCardForm과 같은 원리다: **카드가 곧 폼이다.** 칸에 바로 쓰고,
// 네모를 눌러 고르고, 남/여를 눌러 동그라미 친다. 색을 고정해 둔 것도 같은 이유 — 화면
// 테마가 아니라 인쇄된 종이를 흉내 내는 자리이므로.
//
// 값의 모양과 씨앗(AdultCardValue, adultCardFromMember)은 ./adultCard에 있다.

export function AdultCardForm({
  value,
  onChange,
}: {
  value: AdultCardValue
  onChange: (patch: Partial<AdultCardValue>) => void
}) {
  const setFamily = (idx: number, patch: Partial<AdultFamilyMember>) =>
    onChange({ family: value.family.map((row, i) => (i === idx ? { ...row, ...patch } : row)) })

  return (
    // shrink-0: 다이얼로그의 max-h 컬럼 안에서 이 스크롤 상자의 min-content 높이가 0이라,
    // 없으면 카드가 납작하게 눌린다.
    <div className="scroll-x shrink-0">
      <div className="min-w-[520px] border-2 border-[#111] bg-white text-[#111]">
        <div className="border-b border-[#111] bg-[#efefef] px-2 py-2 text-center font-display text-sm font-bold">
          {ADULT_CARD_TITLE}
        </div>

        {/* 머리 — 방문 일자 · 교우 등록번호 */}
        <Row>
          <Cell label="방문 일자" className="flex-1">
            <DateBox value={value.visitDate} onChange={(v) => onChange({ visitDate: v })} />
          </Cell>
          <Cell label="교우 등록번호" className="flex-1 border-l border-[#111]">
            <TextBox value={value.memberNo} onChange={(v) => onChange({ memberNo: v })} />
          </Cell>
        </Row>

        {/* 성명 한글 / 영문 */}
        <Row>
          <Cell label="성명 (한글)" className="flex-1">
            <TextBox value={value.name} onChange={(v) => onChange({ name: v })} />
          </Cell>
          <Cell label="성명 (영문)" className="flex-1 border-l border-[#111]">
            <TextBox value={value.nameEn} onChange={(v) => onChange({ nameEn: v })} />
          </Cell>
        </Row>

        {/* 성별 · 생년월일 */}
        <Row>
          <Cell label="성별" className="w-[38%]">
            <div className="flex gap-1.5 py-0.5">
              {['남', '여'].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onChange({ gender: value.gender === g ? '' : g })}
                  aria-pressed={value.gender === g}
                  className={
                    'size-7 rounded-full text-sm font-semibold leading-none ' +
                    (value.gender === g ? 'border-2 border-[#111]' : 'border border-transparent text-[#666]')
                  }
                >
                  {g}
                </button>
              ))}
            </div>
          </Cell>
          <Cell label="생년월일" className="flex-1 border-l border-[#111]">
            <DateBox value={value.birthDate} onChange={(v) => onChange({ birthDate: v })} />
          </Cell>
        </Row>

        {/* 전화 — 휴대폰 / 집 · 기타 */}
        <Row>
          <Cell label="휴대폰" className="flex-1">
            <TextBox
              value={value.phone}
              onChange={(v) => onChange({ phone: v })}
              onBlur={() => onChange({ phone: formatPhoneNumber(value.phone) })}
              inputMode="tel"
            />
          </Cell>
          <Cell label="집 · 기타" className="flex-1 border-l border-[#111]">
            <TextBox
              value={value.phoneHome}
              onChange={(v) => onChange({ phoneHome: v })}
              onBlur={() => onChange({ phoneHome: formatPhoneNumber(value.phoneHome) })}
              inputMode="tel"
            />
          </Cell>
        </Row>

        {/* 주소 한 줄 + City / State / Zip */}
        <Row>
          <Cell label="주소" className="flex-1">
            <TextBox value={value.address} onChange={(v) => onChange({ address: v })} />
          </Cell>
        </Row>
        <Row>
          <Cell label="City" className="flex-1">
            <TextBox value={value.city} onChange={(v) => onChange({ city: v })} />
          </Cell>
          <Cell label="State" className="w-[22%] border-l border-[#111]">
            <TextBox value={value.state} onChange={(v) => onChange({ state: v })} />
          </Cell>
          <Cell label="Zip code" className="w-[28%] border-l border-[#111]">
            <TextBox value={value.zipCode} onChange={(v) => onChange({ zipCode: v })} inputMode="numeric" />
          </Cell>
        </Row>

        {/* 참석동기 + 직장/학교명 */}
        <Row>
          <Cell label="참석동기" className="flex-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1 py-0.5">
              {ATTEND_REASONS.map((r) => (
                <Check
                  key={r.key}
                  on={value.attendReason === r.key}
                  label={r.label}
                  onClick={() => onChange({ attendReason: value.attendReason === r.key ? '' : r.key })}
                />
              ))}
            </div>
          </Cell>
        </Row>
        <Row>
          <Cell label="직장 또는 학교명" className="flex-1">
            <TextBox value={value.schoolOrWork} onChange={(v) => onChange({ schoolOrWork: v })} />
          </Cell>
          <Cell label="세례 여부" className="w-[34%] border-l border-[#111]">
            <TextBox value={value.baptismStatus} onChange={(v) => onChange({ baptismStatus: v })} />
          </Cell>
        </Row>

        {/* 동행가족 — 종이의 다섯 줄 */}
        <div className="border-t border-[#111] bg-[#f7f7f7] px-2 py-1 text-[11px] font-bold">동행가족</div>
        <div className="grid grid-cols-[1.2fr_1.2fr_0.9fr_1.1fr_0.6fr] border-t border-[#111] bg-[#f7f7f7] text-[10px] font-semibold">
          {['성명 (한글)', '성명 (영문)', '관계', '생년월일', '성별'].map((h, i) => (
            <div key={h} className={'px-2 py-1 ' + (i > 0 ? 'border-l border-[#111]' : '')}>
              {h}
            </div>
          ))}
        </div>
        {value.family.map((row, i) => (
          <div key={i} className="grid grid-cols-[1.2fr_1.2fr_0.9fr_1.1fr_0.6fr] border-t border-[#111]">
            <FamilyCell>
              <TextBox value={row.nameKo} onChange={(v) => setFamily(i, { nameKo: v })} />
            </FamilyCell>
            <FamilyCell bordered>
              <TextBox value={row.nameEn} onChange={(v) => setFamily(i, { nameEn: v })} />
            </FamilyCell>
            <FamilyCell bordered>
              <TextBox value={row.relation} onChange={(v) => setFamily(i, { relation: v })} />
            </FamilyCell>
            <FamilyCell bordered>
              <DateBox value={row.birthDate} onChange={(v) => setFamily(i, { birthDate: v })} />
            </FamilyCell>
            <FamilyCell bordered>
              <TextBox value={row.gender} onChange={(v) => setFamily(i, { gender: v })} />
            </FamilyCell>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ family: [...value.family, blankFamilyMember()] })}
          className="w-full border-t border-[#111] bg-[#f7f7f7] py-1.5 text-[11px] font-semibold text-[#333] hover:bg-[#efefef]"
        >
          + 가족 한 줄 더
        </button>

        {/* 교회등록 여부 + 등록일 */}
        <Row className="border-t-2">
          <Cell label="교회등록 여부" className="flex-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1 py-0.5">
              {REGISTRATION_CHOICES.map((c) => (
                <Check
                  key={c.key}
                  on={value.registrationChoice === c.key}
                  label={c.label}
                  onClick={() =>
                    onChange({ registrationChoice: value.registrationChoice === c.key ? '' : c.key })
                  }
                />
              ))}
            </div>
          </Cell>
        </Row>
        <Row>
          <Cell label="교회 등록일" className="flex-1">
            <DateBox value={value.registrationDate} onChange={(v) => onChange({ registrationDate: v })} />
          </Cell>
        </Row>
      </div>
    </div>
  )
}

function Row({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={'flex border-t border-[#111] ' + className}>{children}</div>
}

function Cell({
  label,
  children,
  className = '',
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={'min-w-0 px-2 py-1.5 ' + className}>
      <div className="text-[10px] font-semibold text-[#555]">{label}</div>
      {children}
    </div>
  )
}

function FamilyCell({ children, bordered = false }: { children: React.ReactNode; bordered?: boolean }) {
  return <div className={'min-w-0 px-1.5 py-1 ' + (bordered ? 'border-l border-[#111]' : '')}>{children}</div>
}

const BOX =
  'w-full border-0 border-b border-dotted border-[#999] bg-transparent px-0 py-0.5 text-[13px] text-[#111] outline-none focus:border-solid focus:border-[#111]'

function TextBox({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={BOX} />
}

function DateBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={BOX} />
}

function Check({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="flex items-center gap-1 text-[12px]">
      <span className={'grid size-3.5 place-items-center border border-[#111] text-[10px] leading-none ' + (on ? 'bg-[#111] text-white' : '')}>
        {on ? '✓' : ''}
      </span>
      {label}
    </button>
  )
}
