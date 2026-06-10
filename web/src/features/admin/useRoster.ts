import { useQuery } from '@tanstack/react-query'
import { getRoster, type Member, type RosterResponse } from '../../lib/api'

export type RosterData = RosterResponse & { staffMembers: Member[] }

// The role-scoped roster from /api/roster. Enabled only once the admin is verified.
// Staff accounts (is_staff=true) are split out of `members` into `staffMembers` so
// every consumer of `data.members` automatically excludes them from counts, attendance,
// analytics, and check-in pickers — without needing per-component changes.
export const useRoster = (enabled: boolean) =>
  useQuery({
    queryKey: ['roster'],
    queryFn: getRoster,
    enabled,
    select: (data): RosterData => ({
      ...data,
      members: data.members.filter((m) => !m.is_staff),
      staffMembers: data.members.filter((m) => m.is_staff),
    }),
  })
