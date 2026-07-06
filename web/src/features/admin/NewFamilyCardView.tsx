import { cardModel, type CardCell } from './newFamilyCard'
import type { Member } from '../../lib/api'

// On-screen 새가족 등록 카드: the paper card rendered as HTML from the same pure
// `cardModel` the JPG export draws, so the dialog preview, the kiosk form and the
// download can't drift. Fixed light colors on purpose — it's a replica of the
// printed sheet (like the 출석부 grid), not a themed surface. Column proportions
// follow the scan: label | value | label | wider value.
export function NewFamilyCardView({ member }: { member: Member }) {
  const model = cardModel(member)
  return (
    // shrink-0: as a flex item in the dialog's max-h column this scroll container's
    // min-content height is 0 — without it the whole card squashes flat.
    <div className="shrink-0 overflow-x-auto">
      <div className="min-w-[440px] border-2 border-[#111] bg-white text-[#111]">
        <div className="border-b border-[#111] bg-[#efefef] px-2 py-2 text-center font-display text-sm font-bold">
          {model.title}
        </div>
        <table className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '31%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '37%' }} />
          </colgroup>
          <tbody>
            {model.rows.map((row, i) => (
              <tr key={i}>
                <LabelCell text={row.left.label} />
                <ValueCell cell={row.left} />
                <LabelCell text={row.right.label} />
                <ValueCell cell={row.right} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LabelCell({ text }: { text: string }) {
  return <td className="border border-[#111] bg-[#d9d9d9] px-1 py-1.5 text-center font-bold">{text}</td>
}

function ValueCell({ cell }: { cell: CardCell }) {
  const c = cell.content
  return (
    <td className="border border-[#111] px-2 py-1.5 align-middle">
      {c.kind === 'text' && <span>{c.text}</span>}
      {c.kind === 'name' && (
        <span className="inline-flex items-baseline gap-2">
          <span>{c.name}</span>
          <span className="whitespace-nowrap">
            ( <Gender char="남" circled={c.circled === '남'} /> / <Gender char="여" circled={c.circled === '여'} /> )
          </span>
        </span>
      )}
      {c.kind === 'checks' && (
        // One option per line, exactly like the printed card.
        <span className="flex flex-col gap-0.5">
          {c.options.map((o, i) => (
            <span key={o.label} className="inline-flex items-center gap-1.5 leading-tight">
              <span aria-hidden className="grid h-3.5 w-3.5 shrink-0 place-items-center border border-[#111] text-[11px] font-bold">
                {o.checked ? '✓' : ''}
              </span>
              {o.label}
              {o.caption && <span className="text-[10px] text-[#444]">{o.caption}</span>}
              {i === c.options.length - 1 && c.extra ? <span className="ml-1">{c.extra}</span> : null}
            </span>
          ))}
        </span>
      )}
    </td>
  )
}

// 남 / 여 with the member's gender circled in pen, like the paper card.
function Gender({ char, circled }: { char: string; circled: boolean }) {
  return (
    <span className={circled ? 'inline-grid h-6 w-6 place-items-center rounded-full border-[1.5px] border-[#111]' : undefined}>
      {char}
    </span>
  )
}
