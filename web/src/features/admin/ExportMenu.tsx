import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { Member, LogEntry } from '../../lib/api'
import { getConfig } from '../../lib/api'
import { easternNow } from '../../lib/checkinWindow'
import type { Filter } from './filters'
import {
  exportFilename,
  gridSheet,
  logRows,
  kakaoSummary,
  reportHtml,
  type Lang,
} from './exports'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

// Export control for the Sheet tab. Offers Excel (.xlsx), KakaoTalk clipboard summary,
// and a printable HTML report — all built client-side from the already-scoped roster.
// The pure data-shaping lives in exports.ts; only the DOM side-effects live here.
export function ExportMenu({ members, log, filter }: { members: Member[]; log: LogEntry[]; filter: Filter }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Semester dates (for the Excel + report headers) — read-only, cached by react-query.
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })

  const lang: Lang = i18n.language === 'en' ? 'en' : 'ko'
  const today = easternNow().date

  async function doExcel() {
    setBusy(true)
    try {
      // Lazy-load SheetJS (the xlsx-js-style fork — it writes cell fills) so it stays out
      // of the main bundle.
      const XLSX = await import('xlsx-js-style')
      const wb = XLSX.utils.book_new()
      const { aoa, merges, fills } = gridSheet(members, log, lang, today, cfg?.semesterDates)
      const attendance = XLSX.utils.aoa_to_sheet(aoa)
      attendance['!merges'] = merges
      // Paint the per-동산 header colors onto the cells the grid marked.
      for (const f of fills) {
        const addr = XLSX.utils.encode_cell({ r: f.r, c: f.c })
        const cell = attendance[addr] ?? (attendance[addr] = { t: 's', v: '' })
        cell.s = { fill: { patternType: 'solid', fgColor: { rgb: f.rgb } } }
      }
      const full = XLSX.utils.aoa_to_sheet(logRows(members, log, lang))
      XLSX.utils.book_append_sheet(wb, attendance, 'Attendance')
      XLSX.utils.book_append_sheet(wb, full, 'Full Log')
      XLSX.writeFile(wb, exportFilename(filter.group, today))
      setOpen(false)
    } catch {
      toast({ title: t('admin.sheet.export.excelFailed'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function doKakao() {
    const text = kakaoSummary(members, log, today, {
      group: filter.group,
      subgroup: filter.subgroup,
      lang,
    })
    const ok = await copyToClipboard(text)
    toast({ title: ok ? t('admin.sheet.export.copied') : t('admin.sheet.export.copyFailed'), tone: ok ? 'ok' : 'err' })
    if (ok) setOpen(false)
  }

  function doReport() {
    const html = reportHtml(members, log, {
      group: filter.group,
      subgroup: filter.subgroup,
      today,
      lang,
      semesterDates: cfg?.semesterDates,
    })
    const win = window.open('', '_blank')
    if (!win) {
      toast({ title: t('admin.sheet.export.popupBlocked'), tone: 'err' })
      return
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    setOpen(false)
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={members.length === 0}>
        {t('admin.sheet.export.action')}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} title={t('admin.sheet.export.title')}>
          <div className="flex flex-col gap-2">
            <ExportRow title={t('admin.sheet.export.excel')} desc={t('admin.sheet.export.excelDesc')} icon="📊" onClick={doExcel} disabled={busy} />
            <ExportRow title={t('admin.sheet.export.kakao')} desc={t('admin.sheet.export.kakaoDesc')} icon="💬" onClick={doKakao} disabled={busy} />
            <ExportRow title={t('admin.sheet.export.report')} desc={t('admin.sheet.export.reportDesc')} icon="🖨️" onClick={doReport} disabled={busy} />
          </div>
        </Dialog>
      )}
    </>
  )
}

function ExportRow({
  title,
  desc,
  icon,
  onClick,
  disabled,
}: {
  title: string
  desc: string
  icon: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-alt disabled:opacity-50"
    >
      <span className="text-xl" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
    </button>
  )
}

// Clipboard write with an execCommand fallback for older / insecure contexts.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
