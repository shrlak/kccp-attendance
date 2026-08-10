import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { configFor, getConfig, type AppConfig } from './api'
import { useAdminAuth } from '../stores/useAdminAuth'
import { unitTerms, type Partition, type UnitTerms } from './partition'

// 로그인한 부(대학·청년부 / 장년부). 서버가 신원과 함께 내려주는 값이며, 아직 인증 전이거나
// 예전 엣지 함수가 답한 응답이면 대학·청년부로 본다 (이 시스템의 원래 동작).
export function usePartition(): Partition {
  return useAdminAuth((s) => s.identity?.partition ?? 'youth')
}

// 앱 설정 — **로그인한 부의 것**. /api/config는 두 부의 설정을 한 번에 내려주므로(무인증
// 경로라 신원을 풀지 않는다 — lib/api.ts configFor 참고) 고르는 일은 여기서 한 번만 한다.
// 그래서 화면 코드는 예전과 똑같이 cfg?.summerMode / cfg?.groupColors / configCalendar(cfg)를
// 쓰면 되고, 장년부에서는 자동으로 장년부 학기 일정·색·(항상 꺼진) 여름 모드를 보게 된다.
//
// 쿼리 키는 부와 무관하게 하나다: 응답 자체가 두 부의 설정을 함께 담고 있어 캐시를 나눌 이유가
// 없고, 나누면 로그아웃 후 다른 부로 로그인할 때 요청이 한 번 더 나갈 뿐이다.
export function useAppConfig(): { data: AppConfig | undefined } {
  const partition = usePartition()
  const { data } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  return { data: configFor(data, partition) }
}

// ── 부서마다 다르게 불리는 것들: 동산 / 셀 ────────────────────────────────────────────
//
// 대학·청년부는 **동산**·동산지기·부동산지기, 장년부는 **셀**·셀장·부셀장이라고 부른다. 같은
// 데이터(`members.subgroup`)를 가리키는 다른 이름일 뿐이라 화면 로직은 하나로 두고, 문구만
// 갈아끼운다.
//
// 방식은 i18next의 context: `t(key, { context: 'adult' })`는 `key_adult`를 먼저 찾고 없으면
// `key`로 되돌아간다. 그래서 **번역 파일에는 실제로 달라지는 키만 `_adult`로 덧붙이면 되고**,
// 나머지 수백 개 문구는 손대지 않아도 그대로 동작한다. 대학·청년부는 context 'youth' —
// `_youth` 키는 만들지 않으므로 언제나 원래 문구로 떨어진다.
//
// 화면 코드는 `const { t } = useTranslation()` 대신 `const t = usePartitionT()`만 쓰면 된다.
export function usePartitionT(): TFunction {
  const { t } = useTranslation()
  const partition = usePartition()
  return useMemo(
    () => ((key: string, options?: Record<string, unknown>) =>
      t(key, { context: partition, ...options })) as unknown as TFunction,
    [t, partition],
  )
}

// 번역 파일 밖에서 조립되는 라벨(엑셀·PDF·출석부 이미지의 언어별 문자열 표)이 쓰는 어휘.
// lib/partition.ts unitTerms가 표를 들고 있고, 여기서는 로그인한 부와 언어를 붙여 준다.
export function useUnitTerms(lang: 'ko' | 'en'): UnitTerms {
  const partition = usePartition()
  return useMemo(() => unitTerms(partition, lang), [partition, lang])
}
