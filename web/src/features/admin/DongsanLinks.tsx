import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createDongsanLink,
  getDongsanLinks,
  revokeDongsanLink,
  type DongsanLink,
} from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Tag } from '../../components/ui/Tag'
import { Link } from '../../components/ui/Icon'
import { usePartitionT } from '../../lib/useAppConfig'
import { groupsOfPartition, type Partition } from '../../lib/partition'

// 동산 탭의 "동산 리더 링크" — 부서마다 링크를 하나 내고, 복사해서 그 부서 담당자에게 건넨다.
//
// 링크가 곧 범위다: 대학부 링크로는 대학부만 보이고 적힌다. 하나가 새도 새는 것은 그 부서
// 하나뿐이고, 거둘 때도 그 하나만 거둔다. (공용 비밀번호 하나로 리더 전체를 들여보내던 방식을
// 이 프로젝트가 왜 버렸는지는 CLAUDE.md에 있다 — 범위를 짚지 못하는 열쇠가 문제였다.)
//
// 여름학기에는 내지 않는다 — 그 학기의 동산 출석은 구글 시트가 갖고 온다 (아래 rows 주석).
export function DongsanLinksSection({
  summer,
  partition,
}: {
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
    mutationFn: ({ group }: { group: string }) => createDongsanLink(group),
    onSuccess: () => invalidate(),
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  const revoke = useMutation({
    mutationFn: (token: string) => revokeDongsanLink(token),
    onSuccess: () => { invalidate(); toast({ title: t('admin.settings.dongsanLinkRevoked'), tone: 'ok' }) },
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  // **링크는 부서 하나짜리뿐이다** — 대학부 전체 · 청년부 전체. 그 부서의 동산을 다 담고,
  // 화면은 동산별로 묶어 그린다. 동산마다 링크를 따로 내는 방식은 두지 않는다: 적는 사람이
  // 부서 담당자 한 명이면 링크도 하나여야 관리가 되고, 동산이 새로 서거나 이름이 바뀔 때마다
  // 링크를 다시 내고 다시 나눠 주는 일이 없다. 동산이 아직 없는 사람도 이 링크에는 '동산
  // 미지정'으로 남으므로 편성 전에도 쓸 수 있다.
  //
  // **여름학기에는 아무것도 내지 않는다.** 여름 동산 출석은 구글 시트로 들어오고(그 시트가
  // 등록돼 있다), 같은 사람을 시트와 링크로 함께 적으면 다음 동기화에서 시트가 자기 값을 도로
  // 넣는다. 링크는 시트가 없는 학기 — 가을부터 — 의 것이다.
  const rows = summer ? [] : groupsOfPartition(partition).map((group) => ({ group, subgroup: '' }))

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
        {rows.map(({ group }) => {
          const link = links.find((l) => l.group === group && !l.subgroup)
          return (
            <div key={group} className="inset-row min-h-14 items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-text">
                  {t('admin.settings.dongsanLinkWholeGroup', { group })}
                </span>
                <Tag tone="primary">{group}</Tag>
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
                    onClick={() => create.mutate({ group })}
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

      {/* 위 목록에 자리가 없는 링크 — 여름학기라 자리를 안 그렸거나, 동산별로 내던 시절에 낸
          것이 남아 있는 경우. 목록에서 사라지면 거둘 방법도 사라지므로 여기 남겨 둔다. */}
      {links.filter((l) => !rows.some((r) => r.group === l.group && !l.subgroup)).map((l) => (
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
// 이 파일 안에서만 쓴다 — 컴포넌트 파일이 값까지 내보내면 (react-refresh) 핫 리로드가 깨진다.
function linkUrl(token: string) {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}dongsan/${token}`
}
