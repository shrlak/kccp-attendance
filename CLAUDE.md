# KCCP Attendance — project memory

Korean church (한국중앙교회 피츠버그 대학·청년부) attendance system. The active app is a
**React + Vite + TS** SPA in `web/`; the legacy single-file `index.html` was removed at cutover
(recoverable from git history). **Production is live** at https://shrlak.github.io/kccp-attendance/.

## Stack & layout
- `web/` — React + Vite + TypeScript, Tailwind v4 (`@theme` in `web/src/index.css`), Zustand,
  TanStack Query, react-i18next (ko/en in `web/src/i18n/*.json`), React Router, Vitest + RTL.
  Fonts: Jua (display) + Gowun Dodum (body) — rounded/cute Korean.
- `supabase/functions/attendance-api/index.ts` — single Deno edge function (the API gateway,
  uses the **service-role key** → bypasses RLS). `auth.ts` has `verifyAdmin`/`scopeFilter`.
- `supabase/migrations/` — schema. Prod project ref: `loovulhchmmwagtvjnhc`.

## Auth / data model (post-cutover)
- **Admin auth = a shared team password (works from ANY device)**: `kccpadmin` →
  `super_admin` panel, `kccpleaders` → `leader` dashboard, `kccpwelcome` → `welcoming`
  dashboard (in `auth.ts` `SUPER_PASSWORD` / `LEADER_PASSWORD` / `WELCOMING_PASSWORD`, or env
  overrides; `passwordRole()` maps password→role). All are all-roster break-glass logins; a
  password typed on a personal device that's linked to a roled member keeps that member's
  scope instead. No email/Supabase Auth.
- `members` (UUID identity) ⟵ `devices.member_id` / `attendance_log.member_id`; roles in
  `member_roles` (super_admin / leader / pastor / welcoming). Leaders are scoped by group+동산
  (summer mode: KM leaders span 대학부+청년부 = 합동). Pastor is read-only.
- **학기 일정 = 2년치 롤링 목록** (`config.semester_schedule`, `[{year,season,start,end}]` with
  real dates): the 설정 탭 edits the 6 terms that haven't finished (2 academic years). A term that
  ends leaves that window and a fresh one is appended at the back (`rollSchedule`, run on every
  `/api/roster`); finished terms stay stored (last 12) because the archives need the dates the term
  actually ran on. `config.semester_dates` is now just the recurring MM-DD **fallback template** for
  years the list doesn't cover, re-derived from the list on save (`scheduleToDates`). Every date
  helper resolves a term through `termRange(year, season, calendar)` — web `lib/semester.ts`
  (`calendarOf`/`TermCalendar`, fed by `api.ts` `configCalendar(cfg)`), server `term.ts`.
- **여름 모드 is derived, not a toggle**: `term.ts` `isSummerTerm(오늘, config.semester_dates)` —
  on for exactly the 여름학기, off the day after. `config.summer_mode` is dead (never read/written);
  the 설정 탭 shows the state, not a switch.
- **학기 종료 롤오버** (`rolloverDongsan`, runs on the first `/api/roster` after a term ends, once
  per term via `config.dongsan_reset_term`): freezes that term's 동산 편성 into
  `config.dongsan_history` (`{term:{endedAt,subgroups,names,leaders}}`, last 12 terms), then clears
  every member's/device's 동산 + `dongsan_names` + `dongsan_leaders`. `attendance_log.subgroup` is
  left alone (it's that Sunday's record). A NULL `dongsan_reset_term` only seeds the marker — no
  retroactive wipe. The roster returns the (scoped) history so 지난 학기 출석부 keeps its 동산 blocks.
- **A finished 학기 is frozen, roster and 동산 both** (`archive.ts`). Where a term has a snapshot
  it is that term's *only* 동산 source (`archiveGroupBy` no longer falls back to `m.subgroup`) —
  someone the snapshot skips was 동산 미지정 back then, so a later reassignment can't add a block
  to a finished sheet, and re-downloading a term always yields the same workbook. Each period
  also gets its own roster (`periodRoster`): attendance inside the period or a place in that
  term's snapshot proves membership, otherwise `registration_date` — or, when that's blank, the
  member's **first check-in ever** (`firstSeenByName`) — must fall on or before the period's end.
  So a later joiner starts at the term they actually joined, and a 학년도/역년 workbook applies
  all of this per term sheet. The Full Log's 합계 is scored over the union of those rosters.
- **RLS is deny-all** on all tables (no anon/authenticated policies); the edge function
  (service-role) is the only data path.
- 동산지기/부동산지기 are a **display-badge** system (`config.dongsan_leaders`), distinct from the
  `leader` admin role.
- **중복 등록은 자동 병합**: `/api/admin/kiosk-new-member` · `/api/share/new-member` find an existing
  member with the same name + 부서 (and no conflicting phone/생년월일) and update it with the newer
  values instead of inserting a second row — device and attendance history carry over, 등록일자 keeps
  the earlier date so the sheet doesn't blank out past Sundays. Audited as `new-member-merge`.
- **상태 표기 = a list per member** (`members.status_marks` `[{note,start,end}]`; the old single
  `status_note/start/end` trio is still mirrored by the server and read as a one-entry fallback).
  `web/src/lib/status.ts` is the single reader: 귀국/이주 hides the member from the **출석부**
  (when the mark covers the whole shown stretch — a mid-term departure keeps its earlier O/X) and
  from the **키오스크** (along with 방학, `hiddenFromKiosk`); 방학 also drops out of the 통계
  denominator. Other notes (돌아옴 …) just grey out their dates.
- **Login history is 김호연-only**: `/api/admin/login-log` (login_log + `ip_geo` IP→place
  cache, filled from ipwho.is) is gated by `canViewLoginLog` in `auth.ts` — requires
  super_admin **and** memberId == `LOGIN_LOG_VIEWER_MEMBER_ID` (김호연's UUID, env-overridable),
  so a bare shared password never qualifies. `/api/admin/verify` returns the flag; the web
  Admins tab hides the section for everyone else. **Precise location**: the web verify call
  sends the browser's GPS via `X-Geo-Lat/Lon/Acc` (best-effort `getLoginPosition()`; prompts
  once, null if denied) → stored on login_log (`20260726` migration) → reverse-geocoded to a
  street address at read time via Nominatim, cached in `gps_geo`. Falls back to the ip_geo
  city estimate when GPS wasn't granted; the viewer shows a 정확/대략 (precise/approx) badge.

## Deploy / ops — IMPORTANT gotchas
- **Edge function deploys via CI**, not MCP: `mcp__Supabase__deploy_edge_function` and
  `get_edge_function` are **permission-denied** in this environment. `.github/workflows/deploy.yml`
  runs `supabase functions deploy` when the `SUPABASE_ACCESS_TOKEN` repo secret is set (it is).
  So **any `supabase/functions` change deploys on merge to `main`**. Current fn version: v14.
- **Pages deploy `needs` the edge-function job** (atomic cutover) → if the fn deploy **fails**,
  Pages is skipped and the site stays put. But a `changes` job first diffs
  `supabase/functions` over the push range, and the fn job only runs when it actually changed;
  a **skipped** fn job lets Pages through, because an unchanged function is the one the
  frontend was built against. Don't re-tighten this to `needs: success()` — three consecutive
  runner outages ("The job was not acquired by Runner of type hosted") once held back a
  frontend-only deploy that had no function work in it. `changes` failing still blocks Pages
  (unknown ⇒ unsafe). A `notify` job comments deploy-success on the PR.
- **Migrations: add a repo file in `supabase/migrations/` and merge** — since 2026-06-10 prod's
  `schema_migrations` was repaired to match the repo's date-prefix filenames 1:1, so the Supabase
  branching integration is functional again: merge to `main` auto-applies new migration files to
  prod, and PR preview branches replay the full set (keep files **idempotent + guarded**, and
  version prefixes **unique**, ordered after their dependencies — members table exists from
  `20260615`, email from `20260623`). If you must hot-apply via `mcp__Supabase__apply_migration`,
  it records an orphan full-timestamp version that re-breaks the `main` sync ("Remote migration
  versions not found") — afterwards DELETE that row from `supabase_migrations.schema_migrations`
  and add the repo file with the next free date prefix instead.
- **Vite `base: '/kccp-attendance/'`** (GitHub Project Pages subpath) + `BrowserRouter` basename +
  `dist/404.html` SPA fallback. Without the base, every asset 404s → blank page.
  **Vercel PR previews serve at the domain root, so they look broken — preview-only; Pages is prod.**
- Outbound network is allowlisted: `supabase.co` / `github.io` are blocked from this sandbox, so
  HTTP smoke tests of the live function/site fail with "Host not in allowlist". Verify via
  `mcp__Supabase__*` (DB/list_edge_functions) and the GitHub MCP instead.

## Perceived speed — where the waits live
- **A save must never wait on the roster refetch.** `refreshRoster(qc)` (lib/live.ts) is
  deliberately `void`, not awaitable: the mutation already returned, so the dialog closes on
  its own response and the refetch lands underneath. `refreshRosterSettled(qc)` is the
  awaitable twin, for the two callers that need it — the kiosk (holds an optimistic tile
  until the roster confirms) and the DB restore. Re-adding `await refreshRoster(...)`
  reintroduces a full members+log round trip on every save.
- **`/api/roster` is the app's hot path** (every tab reads it, `staleTime: 0`,
  `refetchInterval: 15s`). Its independent queries are batched: `resolveAdmin` ⟂ `getCfg`,
  then members ⟂ guests ⟂ the leader's 동산지기 lookup. The rollover *writes* stay after the
  401 so an unauthenticated request can't trigger a term rollover.
- **Reload** paints from the sessionStorage snapshot (`lib/queryPersist.ts`) before the first
  render; the refetch corrects it underneath.
- **Screen changes** are prefetched, not loaded on tap (`app/prefetch.ts`): route chunks on
  intent *and* on idle after first paint, Chart.js (203 kB) on idle once the panel is up.
  SheetJS (863 kB) is intent-only — the 내보내기 menu opening and hovering an 아카이브
  download — because it's the biggest dependency and exporting is deliberate.
- **Sign-in waits ≤2 s for GPS** (`GEO_LOGIN_WAIT_MS`), then goes without it; a cold
  high-accuracy fix used to hold the verifying screen for up to 9 s to enrich a log line.
  The server still records the IP city estimate, which the viewer labels 대략.
- `fx-*` durations in `index.css` are entrance timings between a tap and usable content —
  keep them short (fade .12s, pop .2s, rise .28s); they are not decoration.

## Git workflow
- Develop on the assigned `claude/...` branch. PRs created as **drafts**, **squash**-merged.
- The branch is deleted on each merge; recurring pattern to ship the next change cleanly:
  `git reset --hard origin/main` → re-apply/`cherry-pick` your commit → `git push --force`.
- Commit identity: `git config user.email noreply@anthropic.com && user.name Claude`. The
  squash-merge commits on `main` (committer `noreply@github.com`) are GitHub's, not yours — never
  rewrite them. Do not put the model id in commits/PRs/code.

## Status
Full Phase 1–4 parity + production cutover complete. Shipped: branded landing, KCCP logo
(light/dark), 동산 admin tab (summer-combined names), bulk 동산 assign/unassign, clear-all
attendance with super-approval, analytics layout, logout→home (a **reload stays put**: the
route is the screen, and the admin panel's tab is remembered in `sessionStorage` via
`web/src/features/admin/adminTab.ts`), 출석부 archives (`features/admin/archive.ts` +
`ArchiveSection.tsx`: the sheet rolls over to the next 학기 — or the gap between two, shown
with the gap's own full Sunday set — the day a term ends, and every finished 학기/전환 기간,
학년도 and calendar year is downloadable as an Excel workbook built from the log at click
time, so clearing attendance clears the archives too). **Status marks are the hiding rule**
(`web/src/lib/status.ts` is the single reader): a mark with **no end date** — 졸업, 타교회 정착,
한국 귀국, 이주 … — or any 귀국/이주/졸업 note takes the member **off the roster everywhere**.
The split happens once, in `useRoster`'s `splitRoster` (same place staff are split off), so
`data.members` never contains them and every tab — 출석부, 오늘, 멤버, 통계, 새가족, 새가족 교육,
방문자, 동산 pickers, 키오스크 — and every count is right without knowing the rule exists. They
come back as `data.hiddenMembers`, used in exactly two places: the 멤버 탭's collapsible
**숨긴 멤버** section (tap a card, clear the mark or give it an end date, and they return), and
`ArchiveSection`, which re-adds them on purpose so a finished 학기's Excel still holds everyone
who was actually there (`awayForRange` then decides per period). 키오스크 additionally hides a
current 방학, and — outside 여름학기 — offers a **부서만 보기** segmented control (전체/대학부/
청년부) chosen inside the kiosk, not a setting. See `docs/superpowers/`
(gitignored; force-added curated docs) for the parity inventory, cutover plan, and runbook.
