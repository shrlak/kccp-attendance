import { useQuery } from '@tanstack/react-query'
import { configFor, getConfig, type AppConfig } from './api'
import { useAdminAuth } from '../stores/useAdminAuth'
import type { Partition } from './partition'

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
