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
- **부(部) = the partition, and the boundary is the Postgres SCHEMA.** 대학·청년부 (`'youth'`)
  lives in `public`, 장년부 (`'adult'`) in `adult` (migration `20260807`) — separate tables,
  separate sequences, separate backups. Reading `public.members` with no filter at all returns
  zero 장년부 people, because they are not in that table. Two departments, one screen, one
  edge function, one Supabase project; **two databases in every way that matters.**
  - `auth.ts` `dbOf(sb, partition)` is **the one place a 부 becomes a database handle.** In the
    request handler that shows up as `adb` (set by `auth()`), and **every authenticated route
    must use `adb.from(...)`, never `sb.from(...)`, for the six tables a department owns**:
    members · devices · attendance_log · member_roles · config · audit_log. `sb.from(...)` in a
    hardened route is a bug — it writes 장년부 data into 대학·청년부's tables.
  - Shared/global tables stay on plain `sb`: `login_log` + `ip_geo`/`gps_geo` (system-wide
    sign-in trail, readable only by the designated viewer), and the legacy `events` /
    `pending_registrations`. The legacy unauthenticated routes (`/api/export/*`,
    `/api/report/html`, `/api/backup`) read `public` and are therefore 대학·청년부-only for free.
  - `scopeFilter()`/`inScope()` still exist and still matter, but for a **different** job now:
    the 동산/셀 scoping a 리더 needs *inside* their own department, plus belt-and-braces on the
    부서. `inScopeGroup()` is the 부서-only twin for write *destinations* ("register a 새가족
    into this 부서"), which must not demand a 동산 the leader hasn't assigned yet.
  - Settings need no `_adult` suffix scheme: **each schema has its own `config` row (id=1)**
    with ordinary column names. Same for `audit_log` — each 부's admin tab reads its own table
    with no filter. The one deliberate cross-schema read is the card-scan quota
    (`cardScanUsage` sums both), because that limit belongs to a single shared API key.
- **Admin auth = a shared team password (works from ANY device)**: `kccpadmin` →
  `super_admin` panel, `kccpleaders` → `leader` dashboard, `kccpwelcome` → `welcoming`
  dashboard, **`kccpadults` → the 장년부 panel** (`super_admin` inside the adult partition — that
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
- `/api/config`는 무인증 경로(랜딩도 부른다)라 신원을 풀지 않고 두 부의 블록을 함께 내려준다
  (`{...youth, adult:{...}}`); 웹은 `useAppConfig()`에서 한 번만 고른다 — 화면 코드는 예전처럼
  `cfg?.summerMode` / `configCalendar(cfg)`를 쓰면 자기 부의 값을 보게 된다. 담긴 것은 날짜와
  색뿐이라 사람 정보가 아니다.
- **장년부는 하위 단위를 "셀"이라 부르고, 셀 이름은 고정이다.** 데이터는 같은 칸
  (`members.subgroup`)이고 이름만 다르다: 대학·청년부는 동산·동산지기·부동산지기, 장년부는
  셀·셀장·부셀장. 화면 문구는 **i18next context**가 맡는다 — `usePartitionT()`가 `t(key,
  {context: partition})`를 걸어 주므로 번역 파일에는 실제로 달라지는 키만 `_adult`로 덧붙이면
  되고(`dongsanNames_adult` …), 없는 키는 원래 문구로 되돌아간다. 번역 파일 밖에서 조립되는
  라벨(엑셀·PDF·출석부 이미지의 언어별 문자열 표)은 `lib/partition.ts` `unitTerms()`를 쓴다.
  **학기 종료 롤오버는 장년부 셀을 초기화하지 않는다** (`RESETS_SUBGROUPS_EACH_TERM`는
  `['youth']`): 스냅숏만 떠서 지난 학기 출석부를 고정하고, 이름·셀장·멤버 배정은 그대로 둔다 —
  바뀌는 것은 셀장·부셀장뿐이기 때문. 웹 쪽 짝은 `subgroupsResetEachTerm()`.
- **장년부 명단은 교회 스프레드시트에서 그대로 옮겨 왔다** (184세대 → 322명, prod
  `adult.members`). 원본이 세대 단위(한 줄에 부부, 전화 D/E·생일 G/H·세례여부 I가 남/여 자리)
  라 사람 단위로 가르기만 하고 **값은 한 글자도 다듬지 않았다** — 전화 표기, 주소 한 줄,
  '집사/권사' 같은 세례여부 문구, 이름에 붙은 `(이사)`까지 원문 그대로다. 어느 사람 것인지
  확실하지 않은 값은 넣지 않고 `notes`에 원문을 남겼고, 가른 뒤에도 되돌릴 수 있도록 그 세대의
  **원본 행 전체가 `adult.members.source_row`(jsonb, `20260809`)** 에 들어 있다. 한 세대는
  `household_id`로 묶인다. 셀 19개와 셀장·부셀장은 교회의 셀 편성표에서 왔고 `adult.config`의
  `dongsan_names`/`dongsan_leaders`에 산다 (`20260810`은 첫 설정만 장년부 것으로 바로잡고,
  이미 편성이 들어 있으면 손대지 않는다). 셀 탭의 `DongsanLeadersEditor`가 그 편집기다 —
  드롭다운은 그 셀 사람들에 **이미 지기로 적혀 있는 바깥 사람을 더한 것**(`leaderOptions`)이라,
  명단과 편성표가 어긋나도 이름이 조용히 지워지지 않는다.
- **여름 합동은 대학·청년부만의 장치**라 장년부에는 존재하지 않는다 (`summerNow(cfg,'adult')`은
  언제나 false, `scopeFilter`도 장년부는 합동으로 승격하지 않는다). 학기 종료 롤오버도 부서별로
  따로 돌며, 편성을 비울 때 자기 부 멤버/기기만 건드린다.
- **RLS is deny-all** on every table in **both** schemas (no anon/authenticated policies); the
  edge function (service-role) is the only data path. The `adult` schema is exposed to PostgREST
  (the migration appends it to `authenticator`'s `pgrst.db_schemas` — appends, never overwrites,
  or Supabase's own `graphql_public` disappears) so `.schema('adult')` can reach it at all.
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
  **두 부 모두에서 보인다** — login_log는 부서를 가리지 않는 공용 표라 어느 패널에서 보든 같은
  목록이고, 아래의 부 건너가기를 해도 memberId는 그대로라 권한이 따라간다. 목록은 **부서별로
  갈라서** 보여준다 (`admins.ts` `groupLoginsByPartition`, 순서는 대학·청년부 → 장년부 →
  부 미기록으로 **고정** — 부는 닫힌 집합이라 자리가 움직이면 매번 찾게 된다). 그러려면 로그인
  마다 그때 들어간 부가 남아야 하므로 `login_log.partition` (`20260814`): 사람의 소속에서
  유도할 수 있는 값이 **아니다** — 유도하면 두 부를 오가는 사람의 장년부 로그인이 전부
  대학·청년부로 읽힌다. 같은 이유로 1시간 중복 제거 키에도 부가 들어간다. 지난 기록은
  `member_id`가 어느 스키마에 있느냐로 되살렸고(123/145), 공용 비밀번호 로그인 18건은 어떤
  비밀번호였는지 어디에도 남지 않아 **비워 뒀다** → '부 미기록'.
- **한 계정만 두 부를 다 본다** (`auth.ts` `CROSS_PARTITION_EMAILS`, 기본 `spencerkim1235@
  gmail.com` = 김호연, env override 가능). 보통 부는 고르는 것이 아니라 **이메일이 어느 스키마의
  members에서 나오느냐**로 정해지는데(그 길 하나뿐이다), 이 이메일만은 로그인 뒤 어느 부의
  패널로 들어갈지 **고른다** — `PartitionChoice` 화면, 그 뒤로는 헤더의 전환 버튼(건너갈 쪽의
  이름이 적혀 있다)으로 오간다. 장년부 members에 행을 하나 더 만들어 주는 방법은 쓰지 않았다:
  그러면 명단·출석부·통계·백업이 전부 교인이 아닌 사람을 한 명 세게 된다.
  - 고른 값은 `X-Partition` 헤더로 매 요청 실려 나간다. **요청이지 권한이 아니다** —
    `resolveAdmin`이 그대로 `verifyAdminJwt`에 넘기고, 거기서 `canCrossPartitions(email)`인
    로그인에만 적용된다. 비밀번호 경로는 아예 읽지 않는다 (비밀번호가 이미 부를 뜻한다).
  - 건너간 쪽에는 그 사람의 members 행이 없다. 그래서 그 부의 `super_admin`이 되되 **부서·동산은
    비우고** 간다 (저쪽 부의 자리 이름이라 여기서는 뜻이 없고, 남기면 scopeFilter가 있지도 않은
    동산으로 명단을 좁힌다). `memberId`는 그대로 들고 가고 새 필드 `Role.memberPartition`이 그
    행이 **실제로 사는** 스키마를 가리킨다 — 로그인 기록의 이름을 거기서 찾는다.
  - 웹 쪽: `lib/partition.ts`의 `ADMIN_PARTITION_KEY`/`readStoredPartition()`을 **api 계층과
    인증 스토어가 각자 읽는다** (한쪽이 다른 쪽 로드를 기다리면 첫 요청의 헤더와 첫 렌더가
    엇갈린다). 부를 바꾸면 `queryClient.clear()` + 스냅숏 폐기가 먼저다 — 화면에 남은 명단은
    전부 저쪽 부의 것이다. 로그아웃하면 선택도 지워져 다음 로그인은 다시 고르는 데서 시작한다.

## Deploy / ops — IMPORTANT gotchas
- **백업은 두 줄기**, 스키마 단위로 완전히 갈린다 (`PARTITION` 환경변수 / `backup.yml`의
  `partition` 입력 + matrix). `youth` → `pg_dump --schema=public` → `backups/`,
  `adult` → `pg_dump --schema=adult` → `backups/adult/`. **어느 파일에도 다른 부서의 사람은
  한 명도 없다.** 두 줄기가 같은 검증을 거친다 (일회용 DB에 마이그레이션 재생 → 덤프 적재 →
  행수 왕복 대조). 각 부서에서 데이터가 바뀔 때만 자기 줄기가 깨어나고 (그 스키마 config의
  `last_auto_backup_at` 청구권), 주간 크론은 입력을 실을 수 없으므로 matrix로 둘 다 돈다.
  복원도 스키마 단위다 — 그 스키마의 표를 전부 `TRUNCATE ... RESTART IDENTITY CASCADE` 하고
  백업을 흘려 넣으므로, 시퀀스를 손으로 밀 필요가 없고 다른 부서는 어느 쪽으로도 닿지 않는다.
  **재해복구는 이제 두 파일 다 필요하다** — `backups/`만으로는 장년부가 복구되지 않는다.
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
**장년부 also runs on this system** (`kccpadults`): the same panel, scoped to its own 부 — 오늘 ·
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
