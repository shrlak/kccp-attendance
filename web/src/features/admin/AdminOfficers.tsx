import { OfficersEditor } from './Officers'

// 임원 admin tab (super-admin only): pick the members who carry the 🎖️ 임원 display
// badge. A display-badge roster (config.officers), independent of admin roles.
export function AdminOfficers() {
  return (
    <div className="w-full max-w-2xl">
      <OfficersEditor />
    </div>
  )
}
