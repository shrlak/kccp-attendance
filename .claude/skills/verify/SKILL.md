---
name: verify
description: Build, launch, and drive the KCCP attendance web app to verify changes at the browser surface.
---

# Verifying the KCCP attendance app

The app is the Vite SPA in `web/` (base path `/kccp-attendance/`). The real backend
(`*.supabase.co`) is **blocked from the sandbox**, so drive the UI with the edge-function
responses mocked at the browser network layer — every API call goes through
`**/functions/v1/attendance-api/**`, all shapes are in `web/src/lib/api.ts`.

## Launch

```bash
cd web && npm ci                      # fresh container has no node_modules
npm run dev -- --port 5199 --strictPort   # serve http://localhost:5199/kccp-attendance/
```

## Drive (Playwright)

`playwright` isn't a repo dep — `npm i playwright` in the scratchpad and launch with
`executablePath: '/opt/pw-browsers/chromium'` (do NOT `playwright install`). Pattern:

- `page.route('**/functions/v1/attendance-api/**', …)` with a small stateful handler
  (keep a `log` array; mutate it on member-checkin / log/remove so tiles re-render on
  the roster refetch).
- Abort `**/realtime/**` (websocket, blocked anyway) and fulfill `**/auth/v1/**`
  with `{}` so supabase-js stays quiet.
- Admin/kiosk auth: mock `POST /api/admin/verify` keyed off the `x-admin-password`
  header → `{ role, group, subgroup, ministry }`.

## Gotchas

- Reload on any path except `/` and `/kiosk` bounces to the landing page (HomeOnReload).
- Kiosk polls `/api/roster` every 15s; the kiosk overlay blocks taps while shown (~1s).
- `tsc -b` needs `npm ci` first; CI (deploy.yml) only runs build — lint/tests are local-only.
