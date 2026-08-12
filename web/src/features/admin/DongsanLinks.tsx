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
import { usePartitionT } from '../../lib/useAppConfig'
import { groupsOfPartition, type Partition } from '../../lib/partition'

// 동산 탭의 "동산 리더 링크" — 자리마다 링크를 하나 내고, 복사해서 그 자리를 맡은 사람에게
// 건넨다 (부서 담당자에게는 부서 링크, 동산지기에게는 그 동산 링크).
//
// 링크를 자리마다 내는 이유는 그 링크가 곧 범위이기 때문이다: 하나가 새도 새는 것은 그 자리
// 하나뿐이고, 거둘 때도 그 하나만 거둔다. (공용 비밀번호 하나로 리더 전체를 들여보내던 방식을
// 이 프로젝트가 왜 버렸는지는 CLAUDE.md에 있다 — 범위를 짚지 못하는 열쇠가 문제였다.)
//
// 여름학기에는 내지 않는다 — 그 학기의 동산 출석은 구글 시트가 갖고 온다 (아래 rows 주석).
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
  //    적거나, 동산 편성이 아직 안 끝났을 때 쓴다.
  //  · **동산 링크** — 그 동산 하나. 동산지기에게 건넨다.
  //
  // **여름학기에는 아무것도 내지 않는다.** 여름 동산 출석은 구글 시트로 들어오고(그 시트가
  // 등록돼 있다), 같은 동산을 시트와 링크로 함께 적으면 다음 동기화에서 시트가 자기 값을 도로
  // 넣는다. 링크는 시트가 없는 학기 — 가을부터 — 의 것이다. 학기가 끝나 편성이 비워진 뒤에는
  // 동산 줄이 없고 부서 줄만 남으며, 가을 동산이 동산이름 편집기에 들어오는 순간 줄이 생긴다.
  const groups = groupsOfPartition(partition)
  const groupRows = summer ? [] : groups.map((group) => ({ group, subgroup: '' }))
  const dongsanRows = summer
    ? []
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

      {/* 여름학기 동안에는 낼 것이 없다 — 그 이유를 자리에 적어 둔다. 이미 낸 링크가 있으면
          아래 목록에 그대로 남아 거둘 수 있다. */}
      {summer && (
        <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted">
          {t('admin.settings.dongsanLinkSummer')}
        </p>
      )}

      <div className={summer && !rows.length ? 'hidden' : 'inset-list'}>
        {isLoading && <div className="inset-row min-h-14 text-sm text-muted">{t('common.loading')}</div>}
        {!isLoading && !rows.length && !summer && (
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
