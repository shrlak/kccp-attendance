# KCCP Attendance — Phase 1–4 Feature-Parity Inventory

> **Scope:** Phases 1–4 of the React + Vite + TypeScript re-platform.  
> Phase 0 (foundation, design system, public check-in) is excluded.  
> All function names are from `index.html` (single ~3,857-line vanilla-JS file).  
> Edge-function endpoints are in `supabase/functions/attendance-api/index.ts`.  
> DB schema is in `supabase/migrations/` (11 files, 2026-05-01 → 2026-06-14).

---

## Global Cross-Cutting Concerns

These apply across all phases:

| Concern | Legacy implementation |
|---------|----------------------|
| **Auth gate** | `tryAdmin()` → `POST /api/check-admin` → checks `config.admin_devices` JSONB array; first device to hit empty array becomes super admin | 
| **Device fingerprint** | `fp()` — deterministic hash of `navigator.userAgent`, screen dims, timezone, etc. Stored in `localStorage["kccp-device-id"]` as `DEV-XXXXXXXX-XXXXXXXX` |
| **API wrapper** | `api(method, path, body, headers)` — wraps `fetch` with 12 s abort timeout; single `API_BASE` constant pointing to Supabase edge function |
| **Data cache** | `D = { devices: {}, log: [] }` — entire DB loaded client-side on `load()`. `localStorage["kccp-dev-v1"]` holds 1-hour device cache. Changes always refetch via `load()` |
| **Timezone** | All date/time is `America/New_York` via `toLocaleString` — hardcoded in both client JS and edge function |
| **i18n** | `STRINGS` object with `ko` / `en` keys; `t(key)` lookup; `lang` from `localStorage["kccp-lang"]`; toggled by `toggleLang()` |
| **Summer mode flag** | `summerMode` boolean, loaded from `config.summer_mode`; auto-detected from `currentSemester()` on client but admin toggle writes to DB |
| **Demo mode flag** | `demoMode` boolean; bypasses day/time/location checks; super-admin only both client and server side |
| **Offline queue** | `queueCheckin()` / `syncOfflineQueue()` — localStorage queue; syncs on `window.online` event |
| **Pull-to-refresh** | `initPullToRefresh()` — touch gesture on admin view; calls `load()` + `renderAll()` |
| **Roster placeholder devices** | ROSTER-XX devices seeded in migrations; real DEV-XX devices supersede them via `supersedeRosterPlaceholders()` server-side |

---

## Phase 1 — Admin Core

### Feature Summary Table

| # | Feature | Status | Parity risk |
|---|---------|--------|-------------|
| 1.1 | Admin password gate | Core | Medium |
| 1.2 | Sheet — grid view | Core | High |
| 1.3 | Sheet — log view | Core | Low |
| 1.4 | Sheet — group/dongsan tab filters | Core | High (summer mode coupling) |
| 1.5 | Today — live check-in list | Core | Medium |
| 1.6 | Today — leader dashboard | Core | High (ACL-scoped) |
| 1.7 | Today — weekly comparison widget | Core | Low |
| 1.8 | Members — member card grid (3-col) | Core | High (flip card, drag reorder) |
| 1.9 | Members — edit member modal | Core | High (12+ fields) |
| 1.10 | Members — merge members | Core | Low |
| 1.11 | Members — transfer member (동산 전출) | Core | Low |
| 1.12 | Roles/ACL enforcement | Core | **Highest** |
| 1.13 | Stats bar | Core | Low |
| 1.14 | Manual attendance edit modal | Core | Medium |
| 1.15 | Manual check-in (admin) | Core | Low |
| 1.16 | Bulk attendance input (from Sheet) | Core | Low |

---

### 1.1 Admin Password Gate

**What it does:** Hides admin functionality behind a password. On first load every device calls `POST /api/check-admin`. If the device's ID is in `config.admin_devices`, it proceeds directly to admin view. Otherwise it shows the check-in screen with a subtle `ADMIN →` button.

**Legacy functions:** `tryAdmin()`, `submitAdminPassword()`, `showAdmin()`

**API / DB:**
- `POST /api/check-admin` — reads `config.admin_devices` (JSONB array); returns `{ isAdmin, noAdminsYet, role, leaderGroup, leaderSubgroup, ministry }`
- `POST /api/admin/add` — writes `config.admin_devices`; requires master password (`config.admin_password`, default `kccpwelcome`); **only super admins** can add admins after the first

**UI:** `#password-modal` overlay; `#admin-access-msg` shows contextual message; `#admin-pw` input

**Roles/ACL:** `noAdminsYet=true` → first device to submit any password becomes super admin. Once admins exist, the master password alone is not enough — a super admin must explicitly grant access.

**Edge cases / gotchas:**
- Admin lookup resolves by device ID, then also checks all other devices sharing the same name (via `getDevsByName`). A person with two linked devices is admin on both.
- The `#password-modal` is reused for two flows (no-admins bootstrap vs. direct password grant). The `admin-access-msg` text distinguishes them.
- "Back to check-in" button (`#back-checkin-btn`) is hidden when `individualCheckinEnabled = false` (kiosk-first mode).

---

### 1.2 & 1.3 Sheet Tab — Grid / Log Views

**What it does:** Spreadsheet of all members × all attendance dates (grid mode), or a reverse-chronological log of every check-in record (log mode).

**Legacy functions:** `renderSheet()`, `setMode()`, `initGridDrag()`, `startGridDrag()`, `onGridDrag()`, `endGridDrag()`

**API / DB:**
- All data comes from in-memory `D` (loaded via `GET /api/data` → `devices` table + `attendance_log` table)
- Name reordering: `saveOrder()` → `POST /api/name-order` → writes `config.name_order`

**UI:**
- Grid view: `<table class="att-table">` with sticky name column, date columns, total column, total row; draggable rows via `⠿` handle
- Log view: `<table class="log-table">` with badge pills (first-visit, manual, visitor)
- Toggle buttons: `#btn-gridview`, `#btn-logview`
- First-visit cells rendered with `class="present first-visit"` (purple color)

**Roles/ACL:**
- `myAllowedGroups` and `myAllowedSubgroup` filter names before render
- 동산지기/부동산지기 (role=`leader`) only see their own 동산
- Clear buttons (`clearLog`, `clearDevices`, `clearEverything`) hidden unless data exists; these are super-admin destructive actions (hold-to-confirm)

**Edge cases / gotchas:**
- Drag-to-reorder in grid mode uses DOM floating + placeholder row; persists via `saveOrder()` after drop. Both the grid and member list have separate drag implementations.
- In summer mode, 대학부 and 청년부 group tabs are still shown on the Sheet tab (`showInSummer=true` param to `renderGrpTabs`) unlike Today tab which collapses them.
- `viewMode` is session state only (not persisted).

---

### 1.4 Sheet — Group / Dongsan Tab Filters

**What it does:** Horizontal pill tabs above the sheet to filter by group (부서) and then by dongsan (동산).

**Legacy functions:** `renderGrpTabs()`, `renderSubgroupTabs()`, `setSheetGroup()`, `setSheetSubgroup()`, `buildSubgroupOptions()`, `getSummerDongsanList()`

**API / DB:**
- Dongsan names from `GET /api/dongsan-names` → `config.dongsan_names` JSONB (`{ "대학부": [...], "청년부": [...] }`)
- No separate API call; filtered from in-memory `D`

**UI:** `#sheet-grp-tabs`, `#sheet-subgrp-tabs` (indented, purple left-border)

**Summer-mode behavior:**
- Group tabs still show (both 대학부 + 청년부) so admins can filter by dept
- Subgroup tabs switch to a flat combined list via `getSummerDongsanList()` (deduped union of all dongsan names across groups)

**Roles/ACL:** `myAllowedGroups` filters which group tabs appear; single-group admins get no "All" tab

---

### 1.5 Today Tab — Live Check-In List

**What it does:** Shows every check-in for today's date, grouped by regular members vs. special roles (pastor, elder, visitor). Includes name initial avatar, group color, dongsan-role badge (👑/⭐), attendance total count, and time.

**Legacy functions:** `renderToday()`, `getMemberRole()`, `getDongsanRole()`, `dongsanRoleTag()`, `grpAccent()`, `grpTag()`

**API / DB:** Filtered from in-memory `D.log` where `e.date === today()`

**UI:** `#today-list`, `#today-label`, group tabs `#today-grp-tabs` + `#today-subgrp-tabs`, weekly comparison `#weekly-comparison`, leader dashboard `#leader-dashboard`

**Roles/ACL:** Same `isGroupAllowed` / `isSubgroupAllowed` filtering as Sheet

**Edge cases:**
- "First-visit or manual with total ≤ 1" gets the purple 🌟 first-visit badge on Today
- Visitors/specials rendered in separate section with different background

---

### 1.6 Today — Dongsan Leader Dashboard

**What it does:** A purple-bordered stats card visible to any admin who has a group+subgroup scoped. Shows today's attendance count, absent count, 4-week average rate, total member count, and a list of absent members' names for the scoped dongsan.

**Legacy functions:** `renderLeaderDashboard()`

**API / DB:** All computed from in-memory `D`; no dedicated API call

**UI:** `#leader-dashboard` div above `#today-list`

**Roles/ACL:**
- Only visible when `myAdminRole && group && subgroup` (either from filter tabs or from `myLeaderGroup/myLeaderSubgroup`)
- In summer mode: collects members across both 대학부 and 청년부 for the dongsan (via `myAllowedGroups`)
- In semester mode: only same-group members

**Edge cases:**
- `avgRate` computed over last 4 dates in log (not calendar weeks); color: green ≥80%, amber ≥60%, red <60%
- Dashboard still shows if a super admin manually filters to a specific group+subgroup

---

### 1.7 Today — Weekly Comparison Widget

**What it does:** Three cards showing this Sunday's count, last Sunday's count, and the delta arrow (↑/↓/→).

**Legacy functions:** `computeWeeklyComparison()`, `renderWeeklyComparison()`

**API / DB:** From in-memory `D.log`; uses `today()` to compute last and this Sunday

**UI:** `#weekly-comparison` div; inline flex cards

**Roles/ACL:** Filtered by `isGroupAllowed`/`isSubgroupAllowed`; uses current `todayGroup`/`todaySubgroup`

---

### 1.8 Members Tab — Member Card Grid

**What it does:** 3-column responsive grid (→ 2-col on tablet, 1-col on mobile) of all members. Each card has a front face (name, tags, attendance count) that flips to a back face (profile details, device IDs, unlink buttons, transfer button). Cards are draggable to reorder.

**Legacy functions:** `renderDevices()`, `renderMemberCard()`, `flipCard()`, `initDragDrop()`, `startDrag()`, `onDrag()`, `endDrag()`

**API / DB:** From in-memory `D.devices`; reorder saved via `POST /api/name-order`

**UI:**
- `.member-grid` CSS grid container
- `.drag-item` with `.flip-wrap` > `.card-inner` (CSS 3D perspective flip)
- `.card-face` (front) + `.card-back` (back, `rotateY(180deg)`)
- `#member-search` input filters in real-time (client-side)
- `#devices-count` label shows `Xmembers · Yvisitors`

**Profile fields shown on back face:**
`gender`, `phone`, `kakaoId`, `birthDate`, `baptismStatus`, `schoolOrWork`, `faithDuration`, `registrationDate`, `pastoralVisitRequested`, `isNewMember` — all from `devices` table (added in `20260606`, `20260614` migrations)

**Roles/ACL:**
- Edit button (✏️) hidden for `myReadOnly` (pastor role)
- Filtered by `myAllowedGroups` + `myAllowedSubgroup`

**Edge cases / gotchas:**
- Two people named `김서현` in the roster are disambiguated as `김서현(대학부)` and `김서현(청년부)` — the app keys members by name string. This is a known collision; React must handle name-based keying carefully or switch to device-ID keying.
- Visitors/specials rendered in a separate section below regulars
- Drag state resets on re-render; `nameOrder` array is the source of truth

---

### 1.9 Members — Edit Member Modal

**What it does:** Full edit form for a member: name, group, dongsan, visitor flag, new-member flag, and 8 extended profile fields.

**Legacy functions:** `openEdit()`, `saveEdit()`, `updateEditSubgroup()`

**API / DB:**
- `PUT /api/device` — updates all fields on `devices` table; when name changes, also updates `attendance_log` by old name

**Fields in `devices` table (from migrations):**
`id`, `name`, `group_name`, `subgroup`, `notes`, `member_role`, `gender`, `phone`, `birth_date`, `baptism_status`, `school_or_work`, `faith_duration`, `registration_date`, `pastoral_visit_requested`, `is_new_member`, `new_member_edu_week1`, `new_member_edu_week2`, `kakao_id`

**UI:** `#edit-modal` overlay; inputs: `#edit-name`, `#edit-group`, `#edit-subgroup`, `#edit-visitor`, `#edit-is-new-member`, `#edit-gender`, `#edit-phone`, `#edit-kakaoid`, `#edit-birthdate`, `#edit-baptism`, `#edit-school`, `#edit-faith`, `#edit-regdate`, `#edit-pastoral`, `#edit-notes`, `#edit-original-name` (hidden)

**Roles/ACL:** Requires admin; `myReadOnly` blocks edit button

**Edge cases:**
- When name changes, `PUT /api/device` updates all `devices` rows with `oldName` and all `attendance_log` rows by name. If a member has multiple linked devices, each device is updated in a loop client-side.
- `baptismStatus` defaults to `"해당없음"` (not applicable)
- Subgroup dropdown uses dynamic `buildSubgroupOptions()` from `dongsanNames` — must match DB-persisted names

---

### 1.10 Members — Merge Members

**What it does:** Merges two member records: all devices from `fromName` are reassigned to `toName`, then `fromName` devices are deleted.

**Legacy functions:** `openMerge()`, `submitMerge()`

**API / DB:** `POST /api/merge-members` → updates `devices` + `attendance_log` by name; writes to `audit_log`

**UI:** `#merge-modal`; two `<select>` dropdowns (`#merge-from`, `#merge-to`); hold-to-confirm

**Roles/ACL:** Any admin

**Edge cases:** Merge is by name only on server — the `to` member's group/subgroup is applied to the migrated devices. Audit log entry written.

---

### 1.11 Members — Transfer Member (동산 전출)

**What it does:** Moves a member to a new group+dongsan combination.

**Legacy functions:** `openTransfer()`, `renderTransferSubgroups()`, `submitTransfer()`

**API / DB:** `POST /api/transfer-member` → updates `devices.group_name` + `devices.subgroup` by name; writes to `audit_log`

**UI:** `#transfer-modal`; `#transfer-group` select → triggers `renderTransferSubgroups()` to populate `#transfer-subgroup`

**Roles/ACL:** Any admin; accessible from member card back face ("🔀 전출" button)

---

### 1.12 Roles / ACL System

**What it does:** Controls which tabs, actions, and data subsets each admin can access.

**Role hierarchy (stored in `config.admin_devices` JSONB array):**

| Role value | Label | Permissions |
|------------|-------|-------------|
| `"super"` (or string device ID) | Super Admin | All tabs, all data, settings, demo mode, add/remove admins |
| `"leader"` | 리더 (동산지기/부동산지기) | Sheet, Today, Members, 새가족 tabs only; scoped to own `group` + `subgroup` |
| `"pastor"` | 목사님/멘토님 | All data read-only; Devices tab hidden |
| `"welcoming"` | 새가족팀 | Read-only + 새가족 tab; `ministry="KM"` |

**ACL variables set in `showAdmin()`:**
- `myAdminRole` — role string or null (null treated as super)
- `myLeaderGroup` / `myLeaderSubgroup` — dongsan scope for leaders
- `myMinistry` — `"KM"` / `"EM"` / `"Adult"` or empty
- `myAllowedGroups` — array of allowed `group_name` values (empty = no restriction)
- `myAllowedSubgroup` — single allowed subgroup string (empty = no restriction)
- `myReadOnly` — true only for pastor role

**Summer-mode ACL interaction:**
- In summer mode, a leader with `group="대학부"` or `"청년부"` gets `myAllowedGroups = ["대학부","청년부"]` (both KM groups) instead of just their own dept
- `myAllowedSubgroup` is still their specific dongsan — they see all members of that dongsan across both departments
- In semester mode, a leader sees only their own 부서

**Tab visibility:**
- `admins` + `settings` nav buttons: hidden unless super
- `devices` nav button: hidden for pastor
- `새가족` nav button: always visible
- Demo mode card in Settings: hidden unless super

**Server-side enforcement:** All mutating endpoints check `isAdmin()` or `isSuperAdmin()`. Role scoping (which data to return) is left to the client — the server returns full data and the client filters. **This is a parity risk: the React re-platform must enforce the same client-side filtering or add server-side row-level filtering.**

**Open question:** Should the React re-platform enforce ACL server-side (via Supabase RLS) or continue with client-side filtering? The current design trusts the client.

---

### 1.13 Stats Bar

**What it does:** Four mini-stat cards (Today / Members / Records / Days) at the top of the admin view, reactive to the active tab's group/subgroup filter.

**Legacy functions:** `renderStats()`

**API / DB:** Computed from in-memory `D`

**UI:** `#stats-bar` flex container; stat cards with `.mono` label and large number

---

### 1.14 Manual Attendance Edit Modal

**What it does:** Opens a per-member attendance edit view — shows all past attendance entries with delete buttons, and a date picker to add a new entry for any date.

**Legacy functions:** `openAttendanceEdit()`, `renderAttendanceModal()`, `addManualAttendance()`, `removeAttendanceEntry()`

**API / DB:**
- Add: `POST /api/log/add-manual` — inserts into `attendance_log` with `is_manual=true`, `admin_added=true`
- Delete: `POST /api/log/remove-entry` (body: `{ ts }`) — deletes by `ts` field; writes audit

**UI:** `#attendance-modal`; `#att-modal-name`; `#manual-date` date picker; `#att-modal-list` scrollable list with delete buttons

**Roles/ACL:** Any admin

**Edge cases:** Add checks for duplicate via `checkedToday` server-side (returns `status: "already"` if record for that date exists). Time for manually added entries is current time at submission.

---

### 1.15 Manual Check-In (Admin)

**What it does:** Admin registers a specific member as present for today, bypassing time/location/day restrictions.

**Legacy functions:** `openAdminCheckin()`, `submitAdminCheckin()`

**API / DB:** `POST /api/admin/checkin` — inserts with `is_manual=true`, `admin_added=true`; writes to `audit_log`

**UI:** `#manual-checkin-modal`; `#mc-name` select (filtered to all members); hidden for `myReadOnly`

**Roles/ACL:** Any admin except read-only (pastor)

---

### 1.16 Bulk Attendance Input (Sheet Tab)

**What it does:** Selects multiple members by checkbox and registers all as present for a chosen date (not necessarily today, unlike the Today tab's bulk check-in).

**Legacy functions:** `openBulk()`, `renderBulkMembers()`, `selectAllBulk()`, `selectNoneBulk()`, `submitBulk()`

**API / DB:** `POST /api/log/add-bulk` — loops server-side, skips duplicates; writes audit

**UI:** `#bulk-modal`; `#bulk-date` date picker; `#bulk-members` scrollable checkbox list

**Roles/ACL:** Any admin; button `#btn-bulk-att` hidden for read-only

**Distinction from 1.15:** This uses a date picker (any past/future date). The Today tab has a separate "일괄 출석" for today only (`#bulk-checkin-modal`).

---

## Phase 2 — Admin Extended

### Feature Summary Table

| # | Feature | Status | Parity risk |
|---|---------|--------|-------------|
| 2.1 | 새가족 tab — current-semester list | Core | High (semester logic) |
| 2.2 | 새가족 tab — education tracking checkboxes | Core | Medium |
| 2.3 | 새가족 tab — monthly registrations | Core | Low |
| 2.4 | Devices tab — register device | Core | Low |
| 2.5 | Devices tab — link device to existing person | Core | Medium |
| 2.6 | Admins tab — add/remove admin | Core | High |
| 2.7 | Admins tab — list admins | Core | Low |
| 2.8 | Admins tab — pending-approval queue | Core | Medium |
| 2.9 | Admins tab — audit log | Core | Low |
| 2.10 | Admins tab — registration approval toggle | Core | Low |
| 2.11 | Admins tab — backup / restore | Core | High |
| 2.12 | Settings — announcement | Core | Low |
| 2.13 | Settings — check-in window (days + times) | Core | Medium |
| 2.14 | Settings — summer mode toggle | Core | **High** |
| 2.15 | Settings — demo mode toggle | Core | Medium |
| 2.16 | Settings — individual check-in toggle | Core | Medium |
| 2.17 | Settings — dongsan name editor | Core | High |
| 2.18 | Settings — dongsan leader/subleader editor | Core | High |
| 2.19 | Summer-mode behavioral changes | Core | **Highest** |

---

### 2.1 새가족 Tab — Current-Semester List

**What it does:** Lists members with `is_new_member = true` whose `registration_date` falls in the **current semester**. Members from previous semesters are hidden automatically (no data mutation — purely a date filter). Admins see name, group, dongsan, registration date, phone, pastoral-visit flag, and education completion chips.

**Legacy functions:** `renderNewMembers()`, `getSemester()`, `currentSemester()`, `_semBeforeMD()`

**Semester logic:**
```
SEMESTER_BOUNDS = { springEnd: [5, 10], summerEnd: [8, 15] }
// month < 5, or month==5 && day < 10  → Spring (봄학기)
// month < 8, or month==8 && day < 15  → Summer (여름학기)
// otherwise                           → Fall (가을학기)
key = `${year}-${season}`   // e.g. "2026-spring"
```
Members with no `registration_date` are kept visible (flagged with orange "등록일 미입력" label).

**API / DB:**
- Read: from `D.devices` in-memory; fields `is_new_member`, `registration_date`, `gender`, `phone`, `pastoral_visit_requested`, `new_member_edu_week1`, `new_member_edu_week2`
- Toggle new-member status: `PUT /api/device` with `{ isNewMember }` on every linked device

**UI:** `#tab-newcomers`; `#newcomer-grp-tabs`; `#newcomers-list`; semester header chip; per-card edu checkboxes

**Roles/ACL:** All admins can view; filtered by `isGroupAllowed`/`isSubgroupAllowed`

**Edge cases:**
- At semester rollover, members automatically drop off with zero DB change. If `currentSemester()` key changes between a page load and an admin action, the list will update on next render.
- Summer semester (late May → mid August) overlaps with summer mode; both are independent features. Summer mode affects the **display grouping** of 부서; the semester affects the **새가족 date window**.

---

### 2.2 새가족 — Education Tracking Checkboxes

**What it does:** Two inline checkboxes per 새가족 card: "새가족교육 1주차" and "새가족교육 2주차". Toggling immediately persists to DB.

**Legacy functions:** `toggleNewMemberEdu(name, week, cb)`

**API / DB:** `PUT /api/device` with `{ newMemberEduWeek1: bool }` or `{ newMemberEduWeek2: bool }` — updates all linked devices for the member

**DB fields:** `devices.new_member_edu_week1`, `devices.new_member_edu_week2` (added in `20260607_new_member_education.sql`)

**Edge cases:** If the `PUT` fails, the checkbox is reverted client-side (`cb.checked = !checked`).

---

### 2.3 새가족 — Monthly Registrations

**What it does:** Below the current-semester list, shows all members (not just `is_new_member`) who have a `registration_date`, grouped by month in reverse chronological order.

**Legacy functions:** `renderMonthlyRegistrations()`

**API / DB:** From `D.devices` in-memory; uses `registration_date` field

**UI:** `#monthly-reg-list`; cards with collapsible month groups

---

### 2.4 Devices Tab — Register Device

**What it does:** Admin manually creates a device record with a specific device ID, name, group, and dongsan.

**Legacy functions:** `registerDevice()`, `updateRegSubgroup()`

**API / DB:** `POST /api/register` — upserts `devices`; updates any `attendance_log` rows with same device ID; calls `supersedeRosterPlaceholders()` (migrates ROSTER-XX placeholder if name matches)

**UI:** `#tab-devices`; `#reg-id` + paste button (`deviceId`), `#reg-name`, `#reg-group`, `#reg-subgroup`

**Roles/ACL:** Any admin

---

### 2.5 Devices Tab — Link Device to Existing Person

**What it does:** Adds a new device ID to an existing named member (the member ends up with multiple linked devices, all sharing the same name).

**Legacy functions:** `linkDevice()`

**API / DB:** `POST /api/link-device` — upserts the new device ID with the existing person's name/group/subgroup; calls `supersedeRosterPlaceholders()`

**UI:** `#link-device-id` + paste button; `#link-name` select (all members); "Link Device" button

**Roles/ACL:** Any admin

**Edge cases:** The "Remove device" (unlink) action on the member card back face calls `DELETE /api/device/:id`. The person remains if other devices exist. If the last device is removed, the person effectively disappears from the member list.

---

### 2.6 Admins Tab — Add / Remove Admin

**What it does:** Adds or removes a device from `config.admin_devices` with a specified role. Role options: Super Admin, 새가족팀, 리더 (with group/subgroup selectors). Removal is also by device ID + master password.

**Legacy functions:** `addAdmin()`, `removeAdmin()`, `removeAdminById()`, `updateAclLeaderFields()`, `updateAclLeaderSubgroup()`

**API / DB:**
- Add: `POST /api/admin/add` — master password required; `isSuperAdmin` check on calling device
- Remove: `POST /api/admin/remove` — master password required; `isSuperAdmin` check

**Role mapping in `addAdmin()`:**
- `"saegajok"` → stored as `role:"welcoming"`, `ministry:"KM"`
- `"leader"` → stored as `role:"leader"`, `ministry:"KM"`, optional `group` + `subgroup`
- `"super"` → stored as `role:"super"`
- `"pastor"` → stored as `role:"pastor"`

**UI:** `#tab-admins`; `#acl-pw`, `#acl-device`, `#acl-role` select, `#acl-leader-fields` (conditionally shown for leader role), `#admin-list`

**Edge cases:**
- Adding an admin for a named person that has multiple linked devices adds ALL their devices to `admin_devices` (server resolves name → all device IDs)
- The master password is stored in `config.admin_password` as plaintext (default: `kccpwelcome`)
- **Open question:** Should the React re-platform hash/salt the master password?

---

### 2.7 Admins Tab — List Admins

**What it does:** Shows all current admins with their role, scoped group/dongsan, and a per-row remove button.

**Legacy functions:** `listAdmins()`

**API / DB:** `POST /api/admin/list` — master password required; super admin only; groups entries by name, counts devices

**UI:** `#admin-list` rendered list; role color-coded tags

---

### 2.8 Admins Tab — Pending Approval Queue

**What it does:** When `requireApproval = true`, self-registrations land in `pending_registrations` table instead of being applied immediately. Admins see a badge on the nav icon and can approve or reject.

**Legacy functions:** `loadPendingList()`, `approvePending()`, `rejectPending()`, `renderPendingBadge()`

**API / DB:**
- Count: `GET /api/pending/count?deviceId=...` — checked on `showAdmin()` and periodically
- List: `GET /api/pending` — requires `X-Device-Id` header
- Approve: `POST /api/pending/approve` — upserts device into `devices`, calls `supersedeRosterPlaceholders()`, writes audit
- Reject: `POST /api/pending/reject` — deletes from `pending_registrations`, writes audit

**DB table:** `pending_registrations(id, device_id, name, group_name, subgroup, requested_at)`

**UI:** `#pending-badge-card` in Admins tab; `#pending-nav-badge` on nav button (red dot, shows count); `#pending-list`

**Edge cases:**
- Badge count is polled once on `showAdmin()`, not reactively updated; admins must navigate to Admins tab or reload
- Approval requires `isAdmin` but not super admin; any admin can approve

---

### 2.9 Admins Tab — Audit Log

**What it does:** Shows last 100 admin actions (check-ins, edits, adds, removes, etc.) in reverse chronological order.

**Legacy functions:** `loadAuditLog()`

**API / DB:** `GET /api/audit` (with `X-Device-Id` header) → `audit_log` table; requires admin

**Audit actions logged:**
`check-in`, `manual-add`, `manual-remove`, `device-register`, `device-edit`, `device-unlink`, `person-remove`, `admin-add`, `admin-remove`, `config-change`, `bulk-add`, `merge-members`, `transfer-member`, `pending-approve`, `pending-reject`, `restore`, `event-create`, `event-delete`, `new-member-register`

**UI:** `#audit-log-list`; loaded on-demand (button click); no auto-refresh

**DB table:** `audit_log(id, ts, action, admin_id, admin_name, details JSONB, created_at)`

---

### 2.10 Admins Tab — Registration Approval Toggle

**What it does:** Toggles `config.require_approval`. When true, self-registrations go to pending queue.

**Legacy functions:** `saveApprovalSetting()`

**API / DB:** `POST /api/config` with `{ requireApproval }` — any admin

**UI:** `#approval-toggle` checkbox in Admins tab

---

### 2.11 Admins Tab — Backup / Restore

**What it does:** Downloads a full JSON snapshot of all data (devices, log, config, events, audit, pending) and restores from a previously downloaded file. Restore is destructive (replaces all data).

**Legacy functions:** `downloadBackup()`, `uploadRestore()`

**API / DB:**
- Download: `GET /api/backup?deviceId=...` → streams JSON; admin required
- Restore: `POST /api/restore` with full JSON body (requires `X-Device-Id`); admin required

**Backup format v2:**
```json
{
  "version": 2,
  "exportedAt": <timestamp>,
  "attendance": { "devices": {...}, "log": [...] },
  "config": { "adminDevices", "nameOrder", "dongsanNames", "checkinDays", "checkinStartMin", "checkinEndMin", "dongsanLeaders", "requireApproval", "announcement", "individualCheckinEnabled" },
  "events": { "events": [...] },
  "audit": [...],
  "pending": [...]
}
```

**UI:** `#backup-title` card in Admins tab; download button, file input for restore; `#restore-status` feedback; hold-to-confirm (2s) for restore

**Edge cases:**
- Restore does NOT include `summer_mode`, `demo_mode`, or `kakao_id` in the v2 config block — these will reset to defaults on restore. **Open question for React implementation.**
- Restore replaces `devices` entirely (delete all → insert all) and `attendance_log` entirely
- Events table is also restored; `event_attendees` are restored as `NAME-{name}` pseudo-device IDs

---

### 2.12 Settings — Announcement

**What it does:** Admin sets a text string that appears on the check-in success screen ("출석 완료!") as a highlighted notice.

**Legacy functions:** `saveAnnouncement()`

**API / DB:** `POST /api/config` with `{ announcement }` → `config.announcement`; read back in `GET /api/config`

**UI:** `#announcement-text` textarea; displayed in check-in success HTML string

---

### 2.13 Settings — Check-in Window

**What it does:** Sets which day(s) of the week and what time range check-in is valid. Outside the window, the check-in screen shows a "wrong day" or "wrong time" restriction screen.

**Legacy functions:** `renderCheckinWindow()`, `saveCheckinWindow()`

**API / DB:** `POST /api/config` with `{ checkinDays, checkinStartMin, checkinEndMin }` → stored as `config.checkin_days` (integer array), `config.checkin_start_min` (integer, minutes from midnight), `config.checkin_end_min`

**Default:** `checkin_days = [0]` (Sunday), `checkin_start_min = 780` (1:00 PM ET), `checkin_end_min = 900` (3:00 PM ET)

**UI:** `#ci-current` display; `#checkin-days-wrap` flex row of day checkboxes; hour/minute selects for start and end; badge on check-in screen (`#checkin-window-badge`)

**Validation:** End > start enforced client-side (`end_before_start` flash)

**Server-side check:** `POST /api/checkin` and `POST /api/guest-checkin` both enforce this; bypassed when `config.demo_mode = true`

---

### 2.14 Settings — Summer Mode Toggle

**What it does:** Enables summer-combined mode. When on, 대학부 and 청년부 are treated as one group for display purposes.

**Legacy functions:** `saveSummerMode()`

**API / DB:** `POST /api/config` with `{ summerMode }` → `config.summer_mode`

**UI:** `#summer-mode-toggle` toggle; `#summer-mode-banner` amber banner visible when active

---

### 2.15 Settings — Demo Mode Toggle

**What it does:** Bypasses all time/day/location restrictions on check-in. Super admin only.

**Legacy functions:** `saveDemoMode()`

**API / DB:** `POST /api/config` with `{ demoMode }` → `config.demo_mode`; server enforces `isSuperAdmin` check

**UI:** `#demo-mode-card` (hidden for non-super); `#demo-mode-toggle`; `#demo-mode-banner` purple banner

**Edge cases:** `isInCheckinWindow()` returns `false` when `demoMode=true` (allowing unrestricted check-in). The check-in window badge shows "DEMO MODE" pill instead of open/closed status.

---

### 2.16 Settings — Individual Check-in Toggle

**What it does:** When disabled (default), non-admin devices see the kiosk grid instead of the personal check-in screen. When enabled, personal check-in is active.

**Legacy functions:** `saveIndividualCheckin()`, `updateCheckinBtnVisibility()`

**API / DB:** `POST /api/config` with `{ individualCheckinEnabled }` → `config.individual_checkin_enabled`

**UI:** `#individual-checkin-toggle`; hides/shows `#back-checkin-btn` in admin header

**Edge cases:** On startup, if `individualCheckinEnabled = false` (DB value) AND device is not admin → `openKioskMode()` is called instead of `doCheckin()`. This is the default behavior.

---

### 2.17 Settings — Dongsan Name Editor

**What it does:** Renames any dongsan. Saves updated name to `config.dongsan_names`, and back-fills the name change in both `devices.subgroup` and `attendance_log.subgroup`.

**Legacy functions:** `renderDongsanEditor()`, `saveDongsanName()`, `saveDongsanNameSummer()`

**API / DB:** `POST /api/dongsan-names` with `{ group, index, name }` → updates `config.dongsan_names` JSONB and runs `UPDATE devices SET subgroup=new WHERE group_name=group AND subgroup=old` + same on `attendance_log`

**UI:** `#dongsan-editor`; per-group sections with per-dongsan text inputs and save buttons

**Summer mode behavior:** Collapses to a flat numbered list (no group label) and saves to ALL groups that have that index slot via `saveDongsanNameSummer()`

---

### 2.18 Settings — Dongsan Leader / Subleader Editor

**What it does:** Sets the 동산지기 (leader) and 부동산지기(s) (sub-leaders) for each dongsan. These roles affect the leader dashboard and role badges on member cards.

**Legacy functions:** `renderDongsanLeadersEditor()`, `saveDongsanLeaders()`, `getDongsanRole()`, `dongsanRoleTag()`

**API / DB:** `POST /api/dongsan-leaders` with `{ group, subgroup, leader, subLeaders }` → updates `config.dongsan_leaders` JSONB; writes audit

**Structure of `config.dongsan_leaders`:**
```json
{
  "청년부": {
    "건영동산": { "leader": "최건영", "subLeaders": ["권상운"] }
  },
  "합동": {
    "호연동산": { "leader": "...", "subLeaders": [...] }
  }
}
```

**Summer mode structure:** Uses `"합동"` top-level key instead of group name

**UI:** `#dongsan-leaders-editor`; per-dongsan block with leader select and subleader checkboxes; filtered to members of that dongsan

**Roles/ACL:** Only super admin (Settings tab hidden for non-super)

**Open question:** The dongsan leader designation is purely a display tag on the client. The `"leader"` admin role scope is separate (stored in `admin_devices`). These are two independent systems that happen to share the same people. The React re-platform should clearly distinguish "dongsan leader display tag" from "leader admin role".

---

### 2.19 Summer Mode — Behavioral Changes Summary

This is the most pervasive cross-cutting concern in the codebase:

| Area | Normal (학기) | Summer mode (여름) |
|------|--------------|-------------------|
| Group tabs | 대학부 / 청년부 / EM / Adult | Tabs hidden on Today (shown on Sheet/Members with `showInSummer=true`) |
| Subgroup tabs | Per-group dongsan list | Flat combined list (all unique dongsan names) |
| Leader ACL scope | Own 부서 only | Both 대학부 + 청년부 for KM leaders |
| Leader dashboard grouping | Same-group members only | Members of that dongsan across both KM groups |
| Weekly comparison | Scoped to group/subgroup | Same |
| Dongsan name editor | Separate per-group | Flat single list, saves to all groups |
| Dongsan leader editor | Separate per-group blocks | Single `"합동"` key |
| `getDongsanRole()` | Looks up `dongsanLeaders[group][subgroup]` | Looks up `dongsanLeaders["합동"][subgroup]` |
| KakaoTalk summary | Group label = group name | Group label = "합동" |
| 새가족 tab | Unchanged | Unchanged (semester-based, independent) |

**Auto-detection:** `summerMode` is initialized by `currentSemester()?.season === 'summer'` on the client, but the DB value (`config.summer_mode`) overrides. The migration `20260609_enable_summer_mode.sql` sets it to TRUE in the live DB.

---

## Phase 3 — Kiosk Mode

### Feature Summary Table

| # | Feature | Status | Parity risk |
|---|---------|--------|-------------|
| 3.1 | Kiosk mode entry / full-screen view | Core | High |
| 3.2 | Kiosk — 6-column member grid | Core | High |
| 3.3 | Kiosk — member tap → check-in | Core | Medium |
| 3.4 | Kiosk — success / already overlay | Core | Low |
| 3.5 | Kiosk — search bar | Core | Low |
| 3.6 | Kiosk — attendance count display | Core | Low |
| 3.7 | Kiosk — guest check-in flow | Core | Low |
| 3.8 | Kiosk — 새가족 registration from kiosk | Core | Medium |
| 3.9 | Kiosk — exit with password | Core | Low |
| 3.10 | Kiosk — 30-second auto-refresh | Core | Low |

---

### 3.1 Kiosk Mode Entry / Full-Screen View

**What it does:** Hides all other views and shows a fixed full-screen overlay for touchscreen attendance. Entered via "🖥️ Kiosk" button in admin header or automatically for non-admin non-individual-checkin devices.

**Legacy functions:** `openKioskMode()`

**UI:** `#kiosk-view` — `position:fixed; inset:0; z-index:999`; `.kiosk-header`, `.kiosk-members` (scrollable), `.kiosk-footer`

**Auto-refresh:** `setInterval(load + renderKioskMembers, 30000)` stored in `_kioskRefresh`

---

### 3.2 Kiosk — 6-Column Member Grid

**What it does:** Displays all non-visitor members in a 6-column grid: 3 columns for 대학부 (yellow), 3 columns for 청년부 (blue). Members already checked in today show green "done" styling. Non-KM members show in a separate grid below.

**Legacy functions:** `renderKioskMembers(searchQuery)`

**Layout:**
- `.kiosk-cols` → 6-column CSS grid
- Each dept split into thirds vertically (ceil(n/3), ceil((n-t1)/2), remainder)
- Column header shows dept name and count on first column, blank space on subsequent columns
- `.kiosk-btn.univ` (yellow), `.kiosk-btn.youth` (blue), `.kiosk-btn.done` (green)

**Search:** `#kiosk-search` input calls `renderKioskMembers(value)` — client-side name filter

**Open question:** Attendance count is hidden from kiosk buttons (commit 08e7d00 hid it). The `kiosk-count` element in the header still shows the total. The React re-platform should not show per-member counts on buttons.

---

### 3.3 Kiosk — Member Tap → Check-In

**What it does:** Tapping a member button shows a fullscreen success overlay, calls the check-in API, then dismisses after 1 second.

**Legacy functions:** `kioskCheckin(name)`

**API / DB:** `POST /api/admin/checkin` — same endpoint as manual check-in; `adminDeviceId = deviceId` (the kiosk device's own ID)

**UI:** `#kiosk-success-overlay` + `#kiosk-success-content` — full-screen overlay with animated check mark or "already" amber indicator

**Edge cases:**
- Uses `api("POST", "/api/admin/checkin", {name, adminDeviceId: deviceId})` — device must have admin role for this to work. Non-admin kiosk devices may fail silently (error is shown for 5 seconds). **Open question:** Should the kiosk have a dedicated unauthenticated check-in endpoint, or should all kiosk devices be granted a minimal "kiosk" role?
- The kiosk does NOT track `lat`/`lng` — location is not checked. Only time/day restrictions apply (via `is_manual: true` flag bypassing location on `admin/checkin`).
- Loading `load()` happens in parallel with showing the success overlay; kiosk grid refreshes after the load completes.

---

### 3.4 Kiosk — Success / Already Overlay

**What it does:** 1-second full-screen overlay. Green checkmark + total count on success; amber "📋 already" on duplicate; countdown bar.

**UI:** `#kiosk-success-overlay` (1s auto-dismiss via `setTimeout`)

---

### 3.5 Kiosk — Search Bar

**What it does:** Text input at top filters the member grid in real-time (client-side).

**UI:** `#kiosk-search`; clears on `openKioskMode()`; `autocomplete="off"`, `autocorrect="off"`, `spellcheck="false"`

---

### 3.6 Kiosk — Attendance Count Display

**What it does:** Shows total unique members checked in today in the kiosk header (excludes visitors).

**Legacy functions:** `updateKioskCount()`

**UI:** `#kiosk-count`; uses `STRINGS[lang].kiosk_count_fn(n)` for bilingual display

---

### 3.7 Kiosk — Guest Check-In Flow

**What it does:** A "👋 방문자 체크인" footer button opens an overlay for name entry, uses `POST /api/admin/checkin` (same as regular kiosk check-in) with no device registration.

**Legacy functions:** `openKioskGuest()`, `submitKioskGuest()`

**API / DB:** `POST /api/admin/checkin` — name only; no device ID association; creates attendance log entry with `is_manual=true`

**UI:** `#kiosk-guest-overlay`; `#kiosk-guest-name` input; `#kiosk-guest-result` feedback

**Note:** This is different from the public-facing guest check-in (`POST /api/guest-checkin`) which enforces time/location. The kiosk guest uses the admin endpoint to bypass restrictions.

---

### 3.8 Kiosk — 새가족 Registration from Kiosk

**What it does:** A "✝️ 새가족 등록" footer button opens a full new-member registration modal, creates a new device record with `is_new_member=true`, and immediately records attendance.

**Legacy functions:** `openNewMemberReg()`, `submitNewMemberReg()`, `updateNmSubgroup()`

**API / DB:** `POST /api/kiosk-new-member` — inserts into `devices` with generated `NEW-{timestamp}` ID and all extended profile fields; immediately inserts into `attendance_log`

**Fields collected:** name (required), group (required), subgroup, gender, phone, kakaoId, birthDate, baptismStatus, schoolOrWork, faithDuration, registrationDate (defaults to today), pastoralVisitRequested

**UI:** `#new-member-modal` — scrollable, within kiosk z-index (z-index: 1001)

**Edge cases:**
- `is_new_member` is hardcoded to `true` on this path; the attendance log entry has `is_manual=true`, `admin_added=false`, `first_visit=true`
- After 2s auto-dismiss, kiosk grid re-renders (new member appears as "done")

---

### 3.9 Kiosk — Exit with Password

**What it does:** Admin password gate to exit kiosk mode and return to the admin panel.

**Legacy functions:** `openKioskExit()`, `submitKioskExit()`

**API / DB:** `POST /api/admin/list` with master password — used only to validate the password; admin list is discarded

**UI:** `#kiosk-exit-modal` (z-index: 1001); `#kiosk-exit-pw` password input

---

### 3.10 Kiosk — Auto-Refresh

**What it does:** Every 30 seconds, reloads `D` from server and re-renders the kiosk grid.

**Implementation:** `setInterval` stored in `_kioskRefresh`; cleared on `submitKioskExit()`

---

## Phase 4 — Analytics & Data

### Feature Summary Table

| # | Feature | Status | Parity risk |
|---|---------|--------|-------------|
| 4.1 | Attendance trend chart (Chart.js line) | Core | Medium |
| 4.2 | Group comparison chart (Chart.js bar) | Core | Medium |
| 4.3 | Monthly / semester summary table | Core | Medium |
| 4.4 | Weekly recap table (Today tab) | Core | Low |
| 4.5 | Weekly summary report (HTML popup) | Core | Medium |
| 4.6 | PDF / print report | Core | Medium |
| 4.7 | KakaoTalk summary clipboard copy | Core | Low |
| 4.8 | Excel export (SheetJS) | Core | High |
| 4.9 | Backup download | See 2.11 | — |
| 4.10 | Backup restore | See 2.11 | — |
| 4.11 | Audit log | See 2.9 | — |

---

### 4.1 & 4.2 Charts (Chart.js)

**What it does:**
- **Trend chart:** Line chart of attendance count per unique date across the filtered log; one line per dataset; y-axis begins at 0
- **Group comparison chart:** Bar chart with one dataset per group (대학부/청년부/EM/Adult), stacked beside each other per date; only shown when not filtered to a single group and not in summer mode

**Legacy functions:** `renderCharts()`, `toggleCharts()`

**Library:** Chart.js 4.4.0 loaded from CDN (`defer`); accessed as `window.Chart`

**State:** `_trendChart`, `_groupChart` — destroyed and re-created on each render; `chartsVisible` boolean toggles visibility

**Roles/ACL:** Filtered by `myAllowedGroups` / `myAllowedSubgroup` + current `sheetGroup` / `sheetSubgroup`

**UI:** `#charts-content` div below summary section; `#charts-toggle-btn` ghost button; canvas elements `trend-chart`, `group-chart`

**Light/dark support:** `tc` (tick color) and `gc` (grid color) switch based on `lightMode`

**Edge cases:**
- Chart.js is loaded with `defer` — if the admin opens the Sheet tab before Chart.js finishes loading, `renderCharts()` shows an error message. **React implementation should lazy-load the chart library.**
- Charts are destroyed/re-created on every `renderSheet()` call (every tab switch, load, etc.) — potential performance issue.
- Group bar chart hidden in summer mode (only trend chart shown)

---

### 4.3 Monthly / Semester Summary

**What it does:** Collapsible section below the sheet showing two tables: (1) monthly aggregates (Sunday count, unique attendees, first-visit count) and (2) semester aggregates (Sunday count, unique attendees).

**Legacy functions:** `toggleSummary()`, `renderSummary()`

**Data:** Computed from `D.log` client-side; excludes visitors

**Semester labeling:** `sem_fn` i18n key: `"2026 상반기"` / `"2026 하반기"` (Korean) or `"2026 Spring"` / `"2026 Fall"` (English)

**Open question:** The semester summary splits at month 6 (Jan–Jun = 상반기, Jul–Dec = 하반기), which differs from the 새가족 semester logic (which uses SEMESTER_BOUNDS with spring/summer/fall seasons). These are two different "semester" concepts. The React re-platform should clarify which is which.

**UI:** `#summary-section` (hidden by default); `#summary-toggle-btn` full-width ghost button; `.summary-table` CSS class

---

### 4.4 Weekly Recap Table (Today Tab)

**What it does:** Collapsible table in the Today tab showing attendance count and first-visit count for the last 7 dates in the log. Includes a copy-to-clipboard button.

**Legacy functions:** `showWeeklyRecap()`

**UI:** `#weekly-recap-section`; `table` with Date / Attendance / First-Visit columns; copy button uses `navigator.clipboard`

**Roles/ACL:** Filtered by `todayGroup` + `todaySubgroup`

---

### 4.5 Weekly Summary Report (HTML popup)

**What it does:** Opens a new browser tab/window with an HTML attendance grid report scoped to the last 7 days, optionally filtered by group.

**Legacy functions:** `openWeeklySummaryReport()`

**API / DB:** `GET /api/report/weekly-summary?group=...` — **Note:** this endpoint is called from the client but does NOT appear in the edge function code. The edge function's `GET /api/report/html` with `period=weekly` is the actual implementation. The client calls `/api/report/weekly-summary` which falls through to `fail(404)`.

**Open question (bug):** `openWeeklySummaryReport()` calls `/api/report/weekly-summary` which does not exist in the edge function. The actual weekly HTML report endpoint is `/api/report/html?period=weekly`. This appears to be a dead link in the current app.

---

### 4.6 PDF / Print Report

**What it does:** Opens the HTML attendance report in a new tab with a print button. Server-side rendered HTML with inline CSS.

**Legacy functions:** `openPrintReport()`

**API / DB:** `GET /api/report/html?period=...&group=...&subgroup=...`

**Report periods supported server-side:** `today`, `weekly` (last 7 days), `monthly` (current month), custom `from`/`to` date range, or `all`

**Report content (built in `buildReportHtml()`):** Stats bar (member count, Sunday count, total attendance, average), attendance grid table with attendance rate % per member (color-coded: ≥80% green, ≥60% amber, <60% red), total row

**UI:** Inline `<button onclick="window.print()">` in the report HTML

---

### 4.7 KakaoTalk Summary Clipboard Copy

**What it does:** Generates a plain-text attendance summary for today and copies it to clipboard. Respects current group/dongsan filter and active language.

**Legacy functions:** `copyKakaoSummary()`

**Format:**
```
📋 KCCP 출석 현황
📅 Sunday, June 7, 2026 (전체)
총 N명 출석

✅ 출석:
1. 김호연
2. ...

👥 방문 / 기타:
1. 방문자이름 (방문자)

📢 [announcement text]
```

**UI:** "💬 카카오 요약" button in Today tab header; uses `navigator.clipboard.writeText` with `execCommand("copy")` fallback

---

### 4.8 Excel Export (SheetJS)

**What it does:** Generates and downloads a `.xlsx` file with two sheets: (1) attendance grid (members × dates, with time values in cells), (2) full log (reverse-chrono with note flags).

**Legacy functions:** `exportExcel()`

**Library:** SheetJS (xlsx) 0.18.5 from CDN (`defer`); accessed as `window.XLSX`

**Sheet 1 — "Attendance" grid:** Columns: Name, Group, Dongsan, Total, [date columns...]; cell value = `e.time` string (e.g. "01:15:23 PM") or empty string

**Sheet 2 — "Full Log":** Columns: Name, Group, Dongsan, Date, Time, Total, Notes (notes = "첫출석 " + "수동 " + "방문자 " concatenated from flags)

**Filename:** `kccp-attendance-{group?}-{date}.xlsx`

**Roles/ACL:** Only uses current `sheetGroup`/`sheetSubgroup` filter for filename label; data is NOT server-filtered — it exports ALL data from `D` (which is already ACL-filtered on the client). A leader can only export their own scoped data because `D.log` + member lists are already filtered.

**Edge cases:**
- SheetJS is `defer`-loaded; if not yet available when triggered, shows "Excel 라이브러리 로딩 중..." warning
- The export dropdown also contains "HTML Report" linking to `openPrintReport()`
- Column widths are hardcoded in `ws["!cols"]` arrays

---

## Open Questions & Parity Risks Summary

| # | Risk / Question | Phase |
|---|----------------|-------|
| OQ-1 | ACL is entirely client-side. The server returns full data; clients filter. Should React add Supabase RLS or keep client-filtering? | 1 |
| OQ-2 | Two people named `김서현` are disambiguated by appending `(대학부)`/`(청년부)` to the name string. The app keys ALL data by name. React must preserve this or introduce a true member UUID that is different from the device ID. | 1 |
| OQ-3 | The master admin password is stored plaintext in `config.admin_password`. Should it be hashed? | 2 |
| OQ-4 | Backup restore (v2) does NOT include `summer_mode`, `demo_mode`, or `kakao_id` in the config block — these reset to defaults on restore. | 2 |
| OQ-5 | `/api/report/weekly-summary` called by `openWeeklySummaryReport()` does not exist in the edge function (returns 404). Appears to be a bug in the legacy app. | 4 |
| OQ-6 | Kiosk uses `POST /api/admin/checkin` which requires the device to be an admin. Non-admin kiosk devices silently fail. Should there be a dedicated `POST /api/kiosk/checkin` endpoint that doesn't require admin auth? | 3 |
| OQ-7 | The "semester" in the `renderSummary()` monthly/semester table (Jan–Jun / Jul–Dec split) is a different concept from the `getSemester()` / `SEMESTER_BOUNDS` system used for 새가족 filtering (spring/summer/fall with specific cutoff dates). These should be clearly separated in React. | 4 |
| OQ-8 | Summer mode is auto-detected client-side from `currentSemester()` season on each load, but the DB value overrides. If the DB says `summer_mode=true` in fall, it will be in summer mode. The admin toggle is the source of truth; auto-detection at startup is a convenience. | 2 |
| OQ-9 | `dongsan_leaders` and the `"leader"` admin role are two independent systems using the same people. The leaders editor sets display badges; the admin_devices entry sets access scope. They must be kept in sync manually by the admin. | 2 |
| OQ-10 | Chart.js and SheetJS are loaded from CDN with `defer`. In React, these should be dynamic `import()`s or npm packages to avoid race conditions and CDN dependency. | 4 |
| OQ-11 | The attendance rate `attRate()` denominates by "all Sundays since this person's first attendance, counting only dates where any non-visitor logged in" — not all calendar Sundays. This subtle denominator must be preserved. | 1 |
| OQ-12 | `supersedeRosterPlaceholders()` in the edge function silently absorbs ROSTER-XX device IDs when a real DEV-XX device is registered for the same name. This migration of audit and admin-role grants is opaque. React/Supabase should document whether this logic is still needed post-re-platform. | 2 |
