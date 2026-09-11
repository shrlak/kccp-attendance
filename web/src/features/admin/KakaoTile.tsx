import { useTranslation } from 'react-i18next'
import type { Member } from '../../lib/api'
import { Copy } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { classifyKakaoId } from './contactQr'
import { copyToClipboard } from '../../lib/clipboard'

// 카톡 아이디 타일 — 탭하면 복사된다. **새가족 탭과 멤버 탭이 같은 이 컴포넌트를 쓴다**
// (NewFamilyFacts가 세 칸을 한 자리에서 그리는 것과 같은 규칙): 같은 값을 두 화면이 각자
// 그리면 한쪽만 고쳐진다.
//
// **카드를 여는 버튼 밖에 둔다** — 안에 넣으면 복사 탭이 편집 창까지 같이 열고, 버튼 안의
// 버튼은 애초에 성립하지 않는다. 고정폭 글꼴은 장식이 아니다: 아이디는 사전이 없어
// l/I/1, O/0을 눈으로만 갈라야 한다. 값이 없으면 아무것도 그리지 않는다.
export function KakaoTile({ member }: { member: Member }) {
  const { t } = useTranslation()
  const toast = useToast()
  const kakao = classifyKakaoId(member.kakao_id)
  if (kakao.kind === 'none') return null

  return (
    <button
      type="button"
      onClick={() => void copyToClipboard(kakao.raw).then((ok) =>
        toast({ title: t(ok ? 'admin.kakaoQr.idCopied' : 'admin.kakaoQr.copyFailed'), tone: ok ? 'ok' : 'err' }),
      )}
      className="mt-1.5 flex w-full items-center gap-1 rounded-lg bg-fill px-1.5 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-fill-hover hover:text-text"
      title={t('admin.kakaoQr.copyOne')}
    >
      <Copy className="size-3 shrink-0 text-subtle" aria-hidden />
      <span className="truncate">{kakao.raw}</span>
    </button>
  )
}
