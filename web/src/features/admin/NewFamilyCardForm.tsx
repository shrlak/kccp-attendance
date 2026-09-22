import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import {
  CARD_TITLE,
  AFFILIATION_CATEGORIES,
  BAPTISM_OPTIONS,
  parseBaptism,
  toggleBaptism,
  BAPTISM_CAPTIONS,
  FAITH_OPTIONS,
  STAY_LABEL,
  STAY_OPTIONS,
  PASTORAL_CONSENT_TEXT,
  formatCardDate,
  type CardFormValue,
} from './newFamilyCard'
import { formatPhoneNumber } from '../../lib/phone'

// ── 새가족 등록 카드 — the paper card as a directly editable form ────────────────
// The card replica IS the form: type into its cells, tap its checkboxes, tap 남/여
// to circle the gender. Used by the member dialog (edit an existing member's card)
// and the kiosk 새가족 등록 (fill a blank card). Fixed light colors on purpose — it
// replicates the printed sheet, not a themed surface. Same field vocabulary as the
// pure cardModel/JPG export, so what you fill in here is exactly what prints.
// The value shape + seeding helpers (CardFormValue, cardFormFromMember,
// blankCardForm) live in ./newFamilyCard with the rest of the pure card model.

export function NewFamilyCardForm({
  value,
  onChange,
  regDateFixed = false,
}: {
  value: CardFormValue
  onChange: (patch: Partial<CardFormValue>) => void
  // Kiosk: 등록일 is stamped to the day the person is added, not typed.
  regDateFixed?: boolean
}) {
  return (
    // shrink-0: as a flex item in the dialog's max-h column this scroll container's
    // min-content height is 0 — without it the whole card squashes flat.
    <div className="scroll-x shrink-0">
      <div className="min-w-[440px] border-2 border-[#111] bg-white text-[#111]">
        <div className="border-b border-[#111] bg-[#efefef] px-2 py-2 text-center font-display text-sm font-bold">
          {CARD_TITLE}
        </div>
        <table className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '31%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '37%' }} />
          </colgroup>
          <tbody>
            <tr>
              <LabelCell text="이름" />
              <ValueCell>
                <span className="flex items-center gap-1.5">
                  <CardInput aria-label="이름" value={value.name} onChange={(v) => onChange({ name: v })} className="min-w-0 flex-1" />
                  <span className="flex shrink-0 items-center whitespace-nowrap">
                    (&nbsp;<GenderChoice char="남" value={value.gender} onChange={(v) => onChange({ gender: v })} />&nbsp;/&nbsp;
                    <GenderChoice char="여" value={value.gender} onChange={(v) => onChange({ gender: v })} />&nbsp;)
                  </span>
                </span>
              </ValueCell>
              <LabelCell text="전화번호" />
              <ValueCell>
                <CardInput
                  aria-label="전화번호"
                  inputMode="tel"
                  value={value.phone}
                  onChange={(v) => onChange({ phone: formatPhoneNumber(v) })}
                />
              </ValueCell>
            </tr>
            <tr>
              <LabelCell text="생년월일" />
              <ValueCell>
                <CardInput aria-label="생년월일" type="date" value={value.birthDate} onChange={(v) => onChange({ birthDate: v })} />
              </ValueCell>
              <LabelCell text="카톡 아이디" />
              <ValueCell>
                <CardInput aria-label="카톡 아이디" value={value.kakaoId} onChange={(v) => onChange({ kakaoId: v })} />
              </ValueCell>
            </tr>
            <tr>
              <LabelCell text="소속 (학교/직장)" />
              <ValueCell>
                <CheckColumn
                  options={AFFILIATION_CATEGORIES.map((c) => ({ value: c, label: c === 'Other' ? 'Other:' : c }))}
                  selected={value.affiliationCategory}
                  onSelect={(v) => onChange({ affiliationCategory: v })}
                />
              </ValueCell>
              <LabelCell text="세례 여부" />
              <ValueCell>
                <CheckColumn
                  multi
                  options={BAPTISM_OPTIONS.map((o) => ({ value: o, label: o, caption: BAPTISM_CAPTIONS[o] }))}
                  selected={value.baptismStatus}
                  onSelect={(v) => onChange({ baptismStatus: v })}
                />
              </ValueCell>
            </tr>
            {/* 왼쪽 반이 위아래로 갈리는 줄: 학교/전공 위, 향후 기간 아래. 오른쪽 신앙생활은
                종이처럼 그 둘을 함께 덮는다 (rowSpan) — 다섯 줄짜리 칸이라 갈리지 않는다. */}
            <tr>
              <LabelCell
                text={
                  <>
                    학교/전공
                    <br />
                    or 직장
                  </>
                }
              />
              <ValueCell>
                <CardTextArea
                  aria-label="학교/전공 or 직장"
                  value={value.affiliationDetail}
                  onChange={(v) => onChange({ affiliationDetail: v })}
                />
              </ValueCell>
              <LabelCell text="신앙생활" rowSpan={2} />
              <ValueCell rowSpan={2}>
                <CheckColumn
                  options={FAITH_OPTIONS.map((o) => ({ value: o, label: o }))}
                  selected={value.faithDuration}
                  onSelect={(v) => onChange({ faithDuration: v })}
                />
              </ValueCell>
            </tr>
            <tr>
              <LabelCell text={STAY_LABEL} />
              <ValueCell>
                {/* 좁은 반 칸이라 보기를 나란히 흘린다 — 세로로 쌓으면 이 칸이 다시 다섯
                    줄이 되어 갈라 놓은 뜻이 없어진다 (카드 렌더러의 flow와 같은 규칙). */}
                <CheckColumn
                  flow
                  options={STAY_OPTIONS.map((o) => ({ value: o, label: o }))}
                  selected={value.stayDuration}
                  onSelect={(v) => onChange({ stayDuration: v })}
                />
              </ValueCell>
            </tr>
            <tr>
              <LabelCell text="등록일" />
              <ValueCell>
                {regDateFixed ? (
                  <span>{formatCardDate(value.registrationDate)}</span>
                ) : (
                  <CardInput
                    aria-label="등록일"
                    type="date"
                    value={value.registrationDate}
                    onChange={(v) => onChange({ registrationDate: v })}
                  />
                )}
              </ValueCell>
              {/* 목회자 연락 동의 — 종이와 같이 라벨 칸 없이 문장 하나가 오른쪽 반을 쓴다.
                  체크는 확인을 받았다는 뜻 하나뿐이라, 풀면 다시 빈 네모로 돌아간다. */}
              <ValueCell colSpan={2}>
                <ConsentCheck
                  text={PASTORAL_CONSENT_TEXT}
                  checked={value.pastoralVisitRequested === true}
                  onToggle={() => onChange({ pastoralVisitRequested: value.pastoralVisitRequested === true ? null : true })}
                />
              </ValueCell>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LabelCell({ text, rowSpan }: { text: ReactNode; rowSpan?: number }) {
  return (
    // break-keep: 한글 라벨이 낱말 가운데서 끊기지 않게 ('향후 피츠버그에 있 / 을 기간').
    <td rowSpan={rowSpan} className="border border-[#111] bg-[#d9d9d9] px-1 py-1.5 text-center font-bold break-keep">
      {text}
    </td>
  )
}

function ValueCell({ children, colSpan, rowSpan }: { children: ReactNode; colSpan?: number; rowSpan?: number }) {
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className="border border-[#111] px-2 py-1.5 align-middle">
      {children}
    </td>
  )
}

// 동의 한 줄: 읽고 표시하는 문장 + 그 **뒤**의 네모 (옵션 줄과 반대 차례 — 여기서는
// 고르는 것이 아니라 문장을 다 읽고 확인한다). 네모가 글 흐름을 따라가야 줄바꿈된 뒤에도
// 마지막 글자 옆에 남으므로 flex가 아니라 inline이고, 접근성 이름은 그 문장 그대로다.
function ConsentCheck({ text, checked, onToggle }: { text: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className="block w-full min-h-6 rounded-sm text-left leading-snug hover:bg-[#f3f4f6]"
    >
      {text}
      <span
        aria-hidden
        className="ml-1.5 inline-grid h-3.5 w-3.5 place-items-center border border-[#111] align-middle text-[11px] font-bold"
      >
        {checked ? '✓' : ''}
      </span>
    </button>
  )
}

// Borderless input living inside a card cell — the pen writing on the paper form.
function CardInput({
  value,
  onChange,
  className = '',
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      className={`w-full min-h-7 rounded-sm bg-transparent text-xs text-[#111] outline-none focus:bg-[#f3f4f6] ${className}`}
    />
  )
}

// Borderless, wrapping textarea for the one field long enough to need it (학교/전공 or
// 직장) — long school/program/workplace names wrap onto multiple lines instead of
// scrolling off in a single-line input.
function CardTextArea({
  value,
  onChange,
  className = '',
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  className?: string
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className'>) {
  return (
    <textarea
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      autoComplete="off"
      className={`w-full min-h-7 resize-none rounded-sm bg-transparent text-xs text-[#111] outline-none focus:bg-[#f3f4f6] ${className}`}
    />
  )
}

// 남 / 여 — tap to circle (tap again to clear), like circling with a pen.
function GenderChoice({ char, value, onChange }: { char: string; value: string; onChange: (v: string) => void }) {
  const active = value === char
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(active ? '' : char)}
      className={
        'inline-grid h-6 w-6 place-items-center rounded-full ' +
        (active ? 'border-[1.5px] border-[#111]' : 'border border-transparent hover:border-[#bbb]')
      }
    >
      {char}
    </button>
  )
}

// The card's ☐ option column — one tappable checkbox row per option. Single-select by
// default (tapping the checked one clears it); with `multi` any number of options can
// be ticked at once (세례 여부) and `selected` carries them as a ", "-joined string.
function CheckColumn({
  options,
  selected,
  onSelect,
  multi = false,
  flow = false,
}: {
  options: { value: string; label: string; caption?: string }[]
  selected: string
  onSelect: (v: string) => void
  multi?: boolean
  // 한 줄에 나란히 흘리고 넘치면 다음 줄로 (반 칸에 앉는 향후 기간).
  flow?: boolean
}) {
  const picked = multi ? parseBaptism(selected) : []
  return (
    <span className={flow ? 'flex flex-wrap items-center gap-x-3 gap-y-0.5' : 'flex flex-col gap-0.5'}>
      {options.map((o) => {
        const checked = multi ? picked.includes(o.value) : selected === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={checked}
            aria-label={o.caption ? `${o.label} ${o.caption}` : o.label}
            onClick={() => onSelect(multi ? toggleBaptism(selected, o.value) : checked ? '' : o.value)}
            className="inline-flex min-h-6 items-center gap-1.5 rounded-sm text-left leading-tight hover:bg-[#f3f4f6]"
          >
            <span aria-hidden className="grid h-3.5 w-3.5 shrink-0 place-items-center border border-[#111] text-[11px] font-bold">
              {checked ? '✓' : ''}
            </span>
            {o.label}
            {o.caption && <span className="text-[10px] text-[#444]">{o.caption}</span>}
          </button>
        )
      })}
    </span>
  )
}
