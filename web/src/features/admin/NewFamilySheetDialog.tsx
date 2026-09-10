import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/Dialog'
import { AttendanceGrid } from './AttendanceGrid'
import { semesterLabel, type Lang } from './exports'
import type { LogEntry, Member } from '../../lib/api'
import type { CalendarLike } from '../../lib/semester'
import { usePartition } from '../../lib/useAppConfig'
import type { Filter } from './filters'

// 새가족 출석표 — **출석부와 같은 표**를 새가족만으로 그린다 (`AttendanceGrid`). 새가족팀이
// 묻는 것은 "이 사람이 그 뒤로 계속 오고 있나"인데, 카드에는 등록일만 있어서 그 답을 보려면
// 출석부 탭으로 건너가 이름을 하나씩 찾아야 했다. 표를 새로 그리지 않고 출석부의 그 표를
// 그대로 쓰는 이유는, 같은 사실을 두 화면이 각자 그리면 한쪽만 고쳐지기 때문이다.
//
// **담기는 사람은 지금 이 탭이 보여주는 새가족 그대로다** — 위쪽 부서·동산 필터와 처지·학교
// 칩까지 걸린 명단(`AdminNewFamily`의 `allNewFamily`). 화면에 보이던 사람들과 표의 사람들이
// 다르면 어느 쪽이 이 탭의 명단인지 알 수 없다.
//
// **블록은 부서로 가른다** (출석부는 동산). 새가족은 아직 동산이 없는 사람이 많아 동산으로
// 묶으면 거의 전부가 '동산 미지정' 한 덩어리가 되고, 그 표는 아무것도 갈라 주지 않는다.
export function NewFamilySheetDialog({
  members,
  log,
  dongsanLog,
  filter,
  today,
  lang,
  semesterDates,
  onClose,
}: {
  members: Member[] // 이 탭이 보여주는 새가족 (필터·칩이 걸린 뒤)
  log: LogEntry[]
  dongsanLog: LogEntry[]
  filter: Filter
  today: string
  lang: Lang
  semesterDates?: CalendarLike
  onClose: () => void
}) {
  const { t } = useTranslation()
  const partition = usePartition()
  const noGroup = t('admin.members.noGroup')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.newfamily.sheet.title')} xwide>
      <AttendanceGrid
        members={members}
        log={log}
        dongsanLog={dongsanLog}
        lang={lang}
        today={today}
        filter={filter}
        semesterDates={semesterDates}
        groupBy={(m) => m.group_name || noGroup}
        caption={`${semesterLabel(today, lang, semesterDates, partition)} · ${t('admin.newfamily.sheet.caption', { n: members.length })}`}
      />
    </Dialog>
  )
}
