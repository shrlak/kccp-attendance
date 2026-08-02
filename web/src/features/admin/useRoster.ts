import { useQuery } from '@tanstack/react-query'
import { getRoster, type Member, type RosterResponse } from '../../lib/api'

export type RosterData = RosterResponse & { staffMembers: Member[] }

// The role-scoped roster from /api/roster. Enabled only once the admin is verified.
// Staff accounts (is_staff=true) are split out of `members` into `staffMembers` so
// every consumer of `data.members` automatically excludes them from counts, attendance,
// analytics, and check-in pickers — without needing per-component changes.
//
// This one query backs the 출석부, 오늘 탭, 멤버별 출석기록 and analytics alike, so its
// freshness settings are what keep them all showing the same attendance. Changes made
// on this device refetch through refreshRoster(); changes from another device arrive as
// a live ping (useAttendanceLive). Everything below is the fallback for pings that never
// land (offline, blocked websocket, backgrounded tab): never serve the cached roster
// without revalidating, poll while the tab is in the foreground, and refetch the moment
// the tab is focused or the network comes back.
export const useRoster = (enabled: boolean) =>
  useQuery({
    queryKey: ['roster'],
    queryFn: getRoster,
    enabled,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    select: (data): RosterData => ({
      ...data,
      members: data.members.filter((m) => !m.is_staff),
      staffMembers: data.members.filter((m) => m.is_staff),
    }),
  })
