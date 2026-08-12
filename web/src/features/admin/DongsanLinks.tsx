import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createDongsanLink,
  getDongsanLinks,
  revokeDongsanLink,
  type DongsanLink,
  type DongsanNames,
} from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Tag } from '../../components/ui/Tag'
import { Link } from '../../components/ui/Icon'
import { summerDongsanList } from './dongsan'
import { usePartitionT } from '../../lib/useAppConfig'
import { groupsOfPartition, type Partition } from '../../lib/partition'

// 동산 탭의 "동산 리더 링크" — 동산마다 링크를 하나 내고, 복사해서 그 동산지기에게 건넨다.
//
// 링크를 동산마다 내는 이유는 그 링크가 곧 범위이기 때문이다: 하나가 새도 새는 것은 그 동산
// 하나뿐이고, 거둘 때도 그 하나만 거둔다. (공용 비밀번호 하나로 리더 전체를 들여보내던 방식을
// 이 프로젝트가 왜 버렸는지는 CLAUDE.md에 있다 — 범위를 짚지 못하는 열쇠가 문제였다.)
export function DongsanLinksSection({
  names,
  summer,
  partition,
}: {
  names: DongsanNames
  summer: boolean
  partition: Partition
}) {
  const t = usePartitionT()
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['dongsanLinks'], queryFn: getDongsanLinks })
  const links = data?.links ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['dongsanLinks'] })

  const create = useMutation({
    mutationFn: ({ group, subgroup }: { group: string; subgroup: string }) => createDongsanLink(group, subgroup),
    onSuccess: () => invalidate(),
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  const revoke = useMutation({
    mutationFn: (token: string) => revokeDongsanLink(token),
    onSuccess: () => { invalidate(); toast({ title: t('admin.settings.dongsanLinkRevoked'), tone: 'ok' }) },
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  // 낼 수 있는 링크는 두 종류다.
  //
  //  · **부서 링크** (subgroup 없음) — 그 부서의 동산을 다 담는다. 부서 담당자가 한 자리에서
  //    적거나, 동산 편성이 아직 안 끝났을 때 쓴다. 여름 합동에도 부서별로 따로 낸다: 동산은
  //    합쳐도 사람은 여전히 대학부 아니면 청년부이고, 담당자는 부서마다 다르기 때문.
  //  · **동산 링크** — 그 동산 하나. 동산지기에게 건넨다.
  //
  // 여름 합동 동산은 두 부서에 걸쳐 있으므로 동산 링크의 부서는 비운다. 학기 중에는 부서마다
  // 동산이 갈리므로 그 부서 이름이 붙는다.
  const groups = groupsOfPartition(partition)
  const groupRows = groups.map((group) => ({ group, subgroup: '' }))
  const dongsanRows = summer
    ? summerDongsanList(names).map((subgroup) => ({ group: '', subgroup }))
    : groups.flatMap((group) => (names[group] ?? []).map((subgroup) => ({ group, subgroup })))
  const rows = [...groupRows, ...dongsanRows]

  async function copy(link: DongsanLink) {
    try {
      await navigator.clipboard.writeText(linkUrl(link.token))
      toast({ title: t('admin.settings.dongsanLinkCopied'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-info/12 text-info">
          <Link size={18} strokeWidth={2} aria-hidden />
        </span>
        <h2 className="font-display text-xl font-bold tracking-tight text-text">
          {t('admin.settings.dongsanLinks')}
        </h2>
      </div>
      <p className="mb-4 mt-2 text-sm text-muted">{t('admin.settings.dongsanLinksDesc')}</p>

      <div className="inset-list">
        {isLoading && <div className="inset-row min-h-14 text-sm text-muted">{t('common.loading')}</div>}
        {!isLoading && !rows.length && (
          <div className="inset-row min-h-14 text-sm text-muted">{t('admin.settings.dongsanEmptyAfterTerm')}</div>
        )}
        {rows.map(({ group, subgroup }) => {
          const link = links.find((l) => l.group === group && l.subgroup === subgroup)
          return (
            <div key={`${group}|${subgroup}`} className="inset-row min-h-14 items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-text">
                  {subgroup || t('admin.settings.dongsanLinkWholeGroup', { group })}
                </span>
                {subgroup ? group && <Tag tone="muted">{group}</Tag> : <Tag tone="primary">{group}</Tag>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {link ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => copy(link)}>
                      {t('admin.settings.dongsanLinkCopy')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:bg-danger/10"
                      onClick={() => revoke.mutate(link.token)}
                      disabled={revoke.isPending}
                    >
                      {t('admin.settings.dongsanLinkRevoke')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => create.mutate({ group, subgroup })}
                    disabled={create.isPending}
                  >
                    {t('admin.settings.dongsanLinkCreate')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 낸 적은 있지만 지금 편성에는 없는 동산 (이름이 바뀌었거나 학기가 끝난 뒤 남은 것).
          목록에서 사라지면 거둘 방법도 사라지므로 여기 남겨 둔다. */}
      {links.filter((l) => !rows.some((r) => r.group === l.group && r.subgroup === l.subgroup)).map((l) => (
        <div key={l.token} className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3 py-2">
          <span className="truncate text-xs text-muted">
            {l.subgroup || t('admin.settings.dongsanLinkWholeGroup', { group: l.group })}
            {l.subgroup && l.group ? ` · ${l.group}` : ''}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => copy(l)}>{t('admin.settings.dongsanLinkCopy')}</Button>
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => revoke.mutate(l.token)}>
              {t('admin.settings.dongsanLinkRevoke')}
            </Button>
          </div>
        </div>
      ))}

      {!!links.length && <p className="mt-3 text-xs text-muted">{t('admin.settings.dongsanLinkHint')}</p>}
    </div>
  )
}

// 링크는 이 앱이 사는 주소 그대로다 (GitHub Pages의 /kccp-attendance/ 하위 경로 포함).
export function linkUrl(token: string) {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}dongsan/${token}`
}
