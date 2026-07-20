import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { useToast } from '../../components/ui/Toast'
import { copyCanvasToClipboard } from './todaySheetImage'

export interface IndividualCopyImage {
  id: string
  label: string
  canvas: HTMLCanvasElement
}

// Chrome does not support writing several ClipboardItems in one operation. Each button
// below creates a fresh user activation, allowing the operator to copy one image, paste
// it into the destination, then return for the next image without combining the images.
export function IndividualImageCopyDialog({ items, onClose }: { items: IndividualCopyImage[]; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [copied, setCopied] = useState<Set<string>>(() => new Set())
  const [copying, setCopying] = useState<string | null>(null)

  async function copy(item: IndividualCopyImage) {
    setCopying(item.id)
    try {
      if (!(await copyCanvasToClipboard(item.canvas))) {
        toast({ title: t('admin.imageCopy.failed'), tone: 'err' })
        return
      }
      setCopied((current) => new Set(current).add(item.id))
      toast({ title: t('admin.imageCopy.copied', { label: item.label }), tone: 'ok' })
    } catch {
      toast({ title: t('admin.imageCopy.failed'), tone: 'err' })
    } finally {
      setCopying(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('admin.imageCopy.title')}>
      <p className="mb-3 text-sm leading-relaxed text-muted">{t('admin.imageCopy.desc')}</p>
      <p className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">
        {t('admin.imageCopy.progress', { done: copied.size, total: items.length })}
      </p>
      <ul className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto pr-1">
        {items.map((item) => {
          const done = copied.has(item.id)
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt px-3 py-2.5">
              <span className="min-w-0 truncate text-sm font-semibold text-text">{item.label}</span>
              <Button
                size="sm"
                variant={done ? 'secondary' : 'primary'}
                onClick={() => void copy(item)}
                disabled={copying !== null}
                aria-label={t(done ? 'admin.imageCopy.copyAgainLabel' : 'admin.imageCopy.copyLabel', { label: item.label })}
              >
                {copying === item.id
                  ? t('admin.imageCopy.copying')
                  : t(done ? 'admin.imageCopy.copyAgain' : 'admin.imageCopy.copy')}
              </Button>
            </li>
          )
        })}
      </ul>
      <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>
        {t('common.close')}
      </Button>
    </Dialog>
  )
}
