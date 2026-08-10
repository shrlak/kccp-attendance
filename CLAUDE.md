# KCCP Attendance — project memory

Korean church (한국중앙교회 피츠버그) attendance system, serving **two departments out of one
app**: 대학·청년부 and 장년부. The active app is a **React + Vite + TS** SPA in `web/`; the legacy
single-file `index.html` was removed at cutover (recoverable from git history). **Production is
live** at https://shrlak.github.io/kccp-attendance/.

## Stack & layout
- `web/` — React + Vite + TypeScript, Tailwind v4 (`@theme` in `web/src/index.css`), Zustand,
  TanStack Query, react-i18next (ko/en in `web/src/i18n/*.json`), React Router, Vitest + RTL.
  Fonts: Jua (display) + Gowun Dodum (body) — rounded/cute Korean.
- `supabase/functions/attendance-api/index.ts` — single Deno edge function (the API gateway,
  uses the **service-role key** → bypasses RLS). `auth.ts` has `verifyAdmin`/`scopeFilter`/
  `inScope` and owns the 부(partition) model. `web/src/lib/partition.ts` is its client mirror —
  keep the two in step, or the UI will offer 부서 the server then rejects.
- `supabase/migrations/` — schema. Prod project ref: `loovulhchmmwagtvjnhc`.

## Auth / data model (post-cutover)
- **부(部) = the partition, and it is the top-level rule.** 대학·청년부 (`'youth'`) and 장년부
  (`'adult'`) share one database and one screen but **never see each other's people**. The
  partition is derived from the 부서: `group_name === '장년부'` is adult, everything else —
  including the blank 부서 that guests and legacy rows carry — is youth. Every admin carries one
  (`Role.partition`), and `auth.ts` `scopeFilter()` is the single place a role becomes rows:
  a 대학·청년부 super gets `{all:true, exclude:['장년부']}`, a 장년부 admin gets
  `{all:false, groups:['장년부']}`. Because `all` no longer means "the whole table", **no caller
  may skip the scope check for super_admin** — every per-row guard goes through `inScope()`
  (or `inScopeGroup()`, the 부서-only twin used for write *destinations* like "register a 새가족
  into this 부서", which must not demand a 동산 the leader hasn't assigned yet). Queries go
  through `scopeQuery()`; note it spells the exclusion as "NULL **or** not 장년부", because
  PostgREST's `neq` silently drops NULL rows.
- **Admin auth = a shared team password (works from ANY device)**: `kccpadmin` →
  `super_admin` panel, `kccpleaders` → `leader` dashboard, `kccpwelcome` → `welcoming`
  dashboard, **`kccpadult` → the 장년부 panel** (`super_admin` inside the adult partition — that
  department runs itself end to end, so it gets settings/동산/관리자 for its own people and
  nothing else). In `auth.ts` `SUPER_PASSWORD` / `LEADER_PASSWORD` / `WELCOMING_PASSWORD` /
  `ADULT_PASSWORD`, or env overrides; `passwordGrant()` maps password→{role, partition}. All are
  break-glass logins covering their own 부's roster; a password typed on a personal device linked
  to a roled member keeps that member's scope instead — **but only when the grant is in the same
  partition as the password**, so the 장년부 password on a 청년부 리더's phone falls back to
  break-glass rather than handing over the 청년부 scope. No email/Supabase Auth.
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
- **설정도 부서별로 갈려 있다** (`20260806` migration): 장년부의 학기 일정·동산 이름·새가족 교육
  동산 이름·동산지기·임원·부서 색·대기 중인 초기화 요청·자동 백업 청구권은 전부 `_adult` 접미사가
  붙은 별도 config 칸에 들어간다. 엣지 함수는 `ck(partition, base)` / `cfgVal(cfg, partition,
  base)`로만 읽고 쓴다 — **접미사를 한 군데라도 빼먹으면 두 부서가 같은 칸을 덮어쓴다.**
  `audit_log.partition`도 같은 이유로 있다 (관리자 탭은 자기 부의 기록만 보여준다; 값이 없는
  예전 행은 대학·청년부로 친다). `/api/config`는 무인증 경로라 두 부의 블록을 함께 내려주고
  (`{...youth, adult:{...}}`), 웹은 `useAppConfig()`에서 한 번만 고른다 — 화면 코드는 예전처럼
  `cfg?.summerMode` / `configCalendar(cfg)`를 쓰면 자기 부의 값을 보게 된다.
- **장년부는 하위 단위를 "셀"이라 부르고, 셀 이름은 고정이다.** 데이터는 같은 칸
  (`members.subgroup`)이고 이름만 다르다: 대학·청년부는 동산·동산지기·부동산지기, 장년부는
  셀·셀장·부셀장. 화면 문구는 **i18next context**가 맡는다 — `usePartitionT()`가 `t(key,
  {context: partition})`를 걸어 주므로 번역 파일에는 실제로 달라지는 키만 `_adult`로 덧붙이면
  되고(`dongsanNames_adult` …), 없는 키는 원래 문구로 되돌아간다. 번역 파일 밖에서 조립되는
  라벨(엑셀·PDF·출석부 이미지의 언어별 문자열 표)은 `lib/partition.ts` `unitTerms()`를 쓴다.
  **학기 종료 롤오버는 장년부 셀을 초기화하지 않는다** (`RESETS_SUBGROUPS_EACH_TERM`는
  `['youth']`): 스냅숏만 떠서 지난 학기 출석부를 고정하고, 이름·셀장·멤버 배정은 그대로 둔다 —
  바뀌는 것은 셀장·부셀장뿐이기 때문. 웹 쪽 짝은 `subgroupsResetEachTerm()`.
- **여름 합동은 대학·청년부만의 장치**라 장년부에는 존재하지 않는다 (`summerNow(cfg,'adult')`은
  언제나 false, `scopeFilter`도 장년부는 합동으로 승격하지 않는다). 학기 종료 롤오버도 부서별로
  따로 돌며, 편성을 비울 때 자기 부 멤버/기기만 건드린다.
- **RLS is deny-all** on all tables (no anon/authenticated policies); the edge function
  (service-role) is the only data path. 예전 단일 파일 클라이언트용으로 남아 있는 무인증 경로
  (`/api/export/*`, `/api/report/html`, `/api/backup` …)는 전부 `youthOnly()`로 묶어 두었다 —
  지금 앱은 쓰지 않지만, 장년부 명단이 그리로 새어 나가서는 안 되므로.
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
- **백업은 두 줄기**, 부서마다 따로 돈다 (`PARTITION` 환경변수 / `backup.yml`의 `partition`
  입력 + matrix). `youth` → `backups/` 는 예전 그대로 **데이터베이스 전체** 덤프이자 재해복구선.
  `adult` → `backups/adult/` 는 **장년부 사람들의 명단과 출석만** 담는다 (전체 덤프를 일회용
  검증 DB에 올린 뒤 `scripts/backup/partition-adult.sql`로 깎아내고 다시 덤프 → 다시 올려
  왕복 검증). 각 부서에서 데이터가 바뀔 때만 자기 줄기가 깨어나고 (`config.last_auto_backup_at`
  / `_adult` 청구권), 주간 크론은 입력을 실을 수 없으므로 matrix로 둘 다 돈다. 패널은 자기
  접두사만 보고 자기 것만 복원한다 — 장년부 복원은 `ADULT_PARTITION_TABLES`
  (attendance_log · member_roles · devices · members)의 장년부 행만 지우고 되돌린 뒤
  attendance_log 시퀀스를 밀어 준다 (전체 복원과 달리 `RESTART IDENTITY`를 쓸 수 없으므로).
  장년부 줄기에 `config`가 없는 것은 의도적이다: 한 행을 두 부서가 나눠 쓰므로 장년부 몫만
  떼어 복원할 방법이 없고, 설정은 전체 스냅숏이 이미 담고 있다.
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
**장년부 also runs on this system** (`kccpadult`): the same panel, scoped to its own 부 — 오늘 ·
출석부 · 멤버 · 통계 · 새가족 · 방문자 · 관리자 · 동산 · 설정 · 키오스크, all of it. **새가족 교육
is deliberately absent** there (it tracks 대학·청년부's two-week course). Its kiosk draws one 부서
block instead of two and drops the 부서만 보기 chips (nothing to choose between); its 새가족 카드
files everyone under 장년부 instead of guessing 대학부/청년부 from 소속; its 설정 탭 has no 여름
모드 row; and its 멤버 dialog drops the 새가족 교육 동산 field. **그 부서에서 동산은 "셀"이고,
셀 이름은 고정** — 학기가 끝나도 지워지지 않고 셀장·부셀장만 바뀐다. The panel header names the 부 on every screen, because that label is the only visible
difference between the two.

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
