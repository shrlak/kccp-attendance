import { useQuery } from '@tanstack/react-query'
import { getRoster } from '../../lib/api'

// The role-scoped roster from /api/roster. Enabled only once the admin is verified.
export const useRoster = (enabled: boolean) =>
  useQuery({ queryKey: ['roster'], queryFn: getRoster, enabled })
