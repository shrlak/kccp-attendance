# KCCP 출석 — Re-platform · Phase 0 Design

- **Date:** 2026-06-07
- **Status:** Draft (awaiting user review)
- **Phase:** 0 of a phased React re-platform
- **Scope:** Foundation + design system + public check-in vertical slice

---

## 1. Context & goal

KCCP 출석 is a Korean-church attendance PWA, today a single ~290 KB `index.html`
(vanilla JS, ~85 functions, 806 inline styles), backed by a Supabase edge function
(`attendance-api`), deployed to GitHub Pages. It is live and in active use.

The user has chosen a **full re-platform** to **React + Vite + TypeScript** with a **bold
new design language**. Because the app is large and live, the re-platform is **phased** —
each phase is its own spec → plan → build, and the current app stays deployed until a new
phase reaches verified parity.

**Phase 0 goal:** stand up the new app's foundation and design system, and prove the whole
stack end-to-end by shipping the **public check-in** experience at full parity. Nothing is
cut over to production in Phase 0.

## 2. Non-goals (explicitly later phases)

- Admin dashboard (Sheet, Today, Members, Newcomers, Devices, Admins, Settings) — Phases 1–2
- Kiosk mode — Phase 3
- Analytics, reports, Excel export, backup/restore, audit log — Phase 4
- Any Supabase schema / edge-function change
- Production cutover (GitHub Pages keeps serving the legacy app)

## 3. Decisions locked (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | Full re-platform (new framework + build step) |
| Framework | React 18 + Vite + TypeScript |
| Design direction | "Warm", tuned for the college / young-adult audience |
| Themes | Both light and dark (parity with current app) |
| Type | Fraunces (display) · Inter (UI/body) · IBM Plex Mono (data) |
| Primary accent | Clay-coral (`#D9603D` light / `#E2714B` dark) |
| Icons | Lucide line icons (no emoji) |
| Rollout | Phased; current app stays live until parity per phase |

## 4. Architecture

### 4.1 Repo & build
- Work on branch **`replatform`**; the React app lives in **`web/`** so the legacy
  root `index.html` is untouched.
- Production `main` → GitHub Pages keeps serving the **legacy app** throughout Phase 0.
- Output is a static Vite build (GitHub Pages can host it at cutover). Vite `base` must match the eventual production path at cutover (custom domain `/` vs project page `/<repo>/`); previews use `/`.

### 4.2 Stack
- **Vite + React 18 + TypeScript**
- **Tailwind CSS v4**, configured against the design tokens in §6 (CSS variables → themes)
- **Radix-based primitives (shadcn/ui)** for accessible Dialog / Dropdown / Toast
- **lucide-react** for icons
- **React Router** — routes `/` (check-in), `/admin`, `/kiosk`. Phase 0 builds `/` fully;
  `/admin` and `/kiosk` are placeholder shells.
- **TanStack Query** over a typed `api()` client wrapping the `attendance-api` edge function
- **react-i18next** with the ported KO/EN catalog (check-in strings in Phase 0)
- **vite-plugin-pwa** (Workbox) — manifest + service worker, replacing hand-written `sw.js` (reuse existing `icon-192.png` / `icon-512.png`)
- Client state via **Zustand** (tiny): theme, language, and the offline queue — Zustand lets the queue be read/updated from `online`/focus handlers outside the React tree without context gymnastics

### 4.3 Data layer
- Reuse `attendance-api` **unchanged**. A typed TS client (`web/src/lib/api.ts`) mirrors the
  legacy `api()` calls. No DB or function changes → backend risk ≈ zero.

### 4.4 App shell & state
- Root layout: theme + language providers, offline/health banner, toast host, router outlet.
- Theme persisted to `localStorage`; respects `prefers-color-scheme` on first load.
- Offline queue persisted to `localStorage`; flushed on `online` event and on app focus.

## 5. Functional scope — the check-in slice (parity targets)

| Legacy behavior | Phase 0 requirement |
|---|---|
| Self check-in (`doCheckin`, `doCheckinFinish`) | Device-recognized member → greeting → check-in → success animation |
| First-time registration (`submitSelfRegister`) | Name + 부서 (group) + 동산 (subgroup) selection, then check in |
| Guest / visitor check-in (`openGuestCheckin`, `submitGuestCheckin`) | Full guest flow |
| Check-in window (`isInCheckinWindow`, badge, `showRestriction`) | Enforce open/closed window + status badge + restriction message |
| Geolocation gating (`getLocation`, location pill, cache) | Request location, show pill, cache, gate per config |
| Offline queue (`queueCheckin`, `syncOfflineQueue`, badge) | Queue offline check-ins, auto-sync on reconnect, show pending badge |
| Health / connection (`pingHealth`, health dot, network info) | Connection indicator + network type |
| Theme + language toggles (`toggleTheme`, `toggleLang`) | Both, persisted |
| Share link (`shareCheckinLink`) | Share / copy check-in URL |
| `ADMIN →` entry (`tryAdmin`) | Routes into the (empty) admin shell |

**Device boundary:** Phase 0 includes device→member recognition and the self-service device
link created on first check-in. *Admin* device management (the Devices tab) is Phase 2.

**Admin boundary:** the `/admin` shell in Phase 0 is an unauthenticated placeholder; the admin
password gate, roles/ACL, and auth land in Phase 1.

## 6. Design tokens (source of truth)

**Fonts:** Fraunces (display, 500–700) · Inter (UI/body, 400–700) · IBM Plex Mono (data, 500).
**Radius:** sm 8 · md 12 · lg 16 · xl 20 · pill 9999. **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 (4-pt grid).

| Token | Light | Dark |
|---|---|---|
| bg | `#FBF7F0` | `#16120E` |
| surface | `#FFFFFF` | `#211B15` |
| surface-2 | `#F2EADD` | `#2B2219` |
| border | `#ECE2D3` | `#322A22` |
| text | `#2B2622` | `#F2E9DC` |
| text-muted | `#7A6E5F` | `#B5A48F` |
| text-subtle | `#A8957E` | `#9A8466` |
| primary | `#D9603D` | `#E2714B` |
| primary-hover | `#C2542F` | `#EC8059` |
| primary-fg | `#FFFFFF` | `#241009` |
| gold | `#E8A23D` | `#E8A23D` |
| success | `#4F9D69` | `#6FBE86` |
| warning | `#D98A1F` | `#E6B45A` |
| danger | `#D14D4D` | `#E07A6A` |
| info | `#4A7BB8` | `#6FA0D6` |

**Group tag palette (light → text):** 대학부 `#FBEDE6`/`#C2542F` · 청년부 `#FBF0DA`/`#B07414` ·
EM `#E8F0F8`/`#3A6CA3` · 동산 `#E6F2EA`/`#3E7E54` (dark = token tint at 16% on matching hue).

**Core components (Phase 0):** Button (primary/secondary/ghost/danger/disabled/sm),
Input, Select, Card, Tag, bottom Nav (≤5 items, icon+label, active state), Toast
(ok/warn/err), Dialog/Modal. All built in both themes.

## 7. Accessibility (design-led, enforced from day one)

- Text contrast ≥ 4.5:1 (verify token pairs in both themes); large text ≥ 3:1.
- Touch targets ≥ 44×44; ≥ 8 px spacing; `touch-action: manipulation`.
- Visible focus rings; keyboard operable; Radix primitives provide focus trap / escape / aria.
- Color never the sole signal (icon + text on status).
- Respect `prefers-reduced-motion` for the success/celebration animations.
- Korean + English both legible at 16 px base; support dynamic text size without truncation.
- Safe-area insets honored (notch / home indicator) — carried into layout tokens.

## 8. Error handling

| Condition | Behavior |
|---|---|
| Offline at check-in | Queue locally, optimistic success state, "오프라인 — 대기열" toast, sync on reconnect |
| Geolocation denied / unavailable | Show status in location pill; fall back per config (allow vs block) with clear message |
| Check-in window closed | Disable check-in, show restriction message + window badge |
| `attendance-api` error / timeout | Inline error with retry; never lose the user's queued action |
| Duplicate check-in | Idempotent against same member+date (match legacy behavior) |

## 9. Testing & verification

- **Unit/component (Vitest + React Testing Library):** check-in-window logic, offline
  queue (enqueue + flush), i18n switching, `api()` client (mocked), token/theme application.
- **Parity checklist:** each legacy check-in function → React equivalent, manually verified.
- **Device test (real phone):** install/PWA, offline check-in + sync, geolocation prompt,
  KO/EN switch, light/dark, safe areas.
- **Lighthouse:** PWA + accessibility pass.
- Legacy app kept live as the behavioral reference for comparison.

## 10. Deploy / preview

- **Recommended:** Vercel **preview deploys** per branch — zero-config for Vite, HTTPS
  (required for geolocation + PWA), production GitHub Pages untouched.
- **Fallback (if avoiding Vercel):** local Vite dev; for HTTPS device testing (needed for
  geolocation/PWA) use a tunnel (cloudflared / ngrok).
- **SPA routing on static hosts:** GitHub Pages has no SPA fallback — use `HashRouter` or the
  `404.html` copy trick so deep links resolve. Vercel handles this automatically. Pick a
  strategy that works on both.
- *(Open decision — see §13.)*

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| PWA cache staleness (hit before, legacy #37) | Workbox precache + versioned SW + skipWaiting/clientsClaim strategy |
| iOS PWA quirks (safe areas, status bar) | Encode safe-area insets in tokens; test on device |
| Offline-queue correctness | Dedicated unit tests; idempotent sync; visible pending state |
| Geolocation needs HTTPS | Preview + production are HTTPS |
| Scope creep into admin/kiosk | Hard non-goals (§2); admin/kiosk are empty shells in Phase 0 |

## 12. Definition of done

Public check-in runs at parity with the legacy app on a preview URL — self/guest check-in,
window enforcement, geolocation, offline queue + sync, KO/EN, light/dark, install/PWA — the
design system is implemented in both themes, tests pass, and **production still serves the
legacy app** (no cutover).

## 13. Open decisions

- **Preview host:** Vercel previews (recommended) vs local-only + Pages preview. Default to
  Vercel unless the user opts out.

## 14. Program note — phasing & parallelism

Phases are sequenced because each depends on Phase 0's foundation (design system, component
library, `api()` client, routing, i18n) and shares those surfaces. Parallel agents across
phases would conflict and diverge, undermining the consistency goal. Parallelism is reserved
for: (a) read-only legacy analysis to pre-draft later-phase parity specs, and (b) splitting
independent screens *within* a phase once the foundation is frozen and merged.

## 15. Scope note — Phase 0 is the largest phase

Phase 0 bundles the foundation, the design system, and the check-in flow (including the
trickier offline / geolocation / PWA concerns). **Recommendation:** keep it as **one** phase
but **sequence the build internally** — (1) scaffold + design system + component library,
(2) typed `api()` client + online-only self check-in (proves design + data + deploy),
(3) harden with geolocation, offline queue + sync, Workbox PWA, (4) guest flow +
window/restriction polish. If the implementation plan comes out too large, split into **0a**
(steps 1–2) and **0b** (steps 3–4). Default: one phase, sequenced.
