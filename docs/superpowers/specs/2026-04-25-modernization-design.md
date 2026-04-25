# KCCP Attendance — Modernization Design

**Date:** 2026-04-25  
**Scope:** Meaningful modernization pass — UI polish, UX improvements, new features, GitHub Pages deployment  
**Approach:** B (moderate modernization — preserve single-file SPA, no build pipeline)

---

## 1. Visual & UI Changes

**Attendance table header color**  
Replace the inconsistent purple (`#4a2d87`) with the existing dark card palette. Use the green accent (`#34D399`) for column highlights to match the rest of the design system.

**Navigation bar active state**  
Replace the top-border active indicator with a filled pill/capsule behind the active icon+label. Increase height slightly for better touch targets on mobile.

**Dashboard summary strip**  
Add a compact "today at a glance" bar at the top of the check-in view showing: total checked in today, attendance percentage, and current group tab. One row, no extra navigation.

**Light mode card elevation**  
Add a subtle box-shadow to cards in light mode to give them depth. Dark mode unchanged.

**Tag/badge consistency**  
Standardize all status badges to use the existing `.tag` CSS classes. Remove ad-hoc inline styles.

---

## 2. UX & Usability Improvements

**Member search**  
Real-time search bar in the Members view. Filters by name across all groups as you type. Single-tap clear button.

**Skeleton loading screens**  
Replace blank flash on data load with greyed-out placeholder cards matching the real layout.

**Empty states**  
When a group has no members or no attendance today, show a short message with a relevant action CTA ("Add member", "Force check-in") instead of blank space.

**Check-in celebration animation**  
On successful check-in, animate the member card with a scale pop + green glow before settling. Makes NFC taps feel more satisfying.

**Admin panel reorganization**  
Add labeled sections (Members, Attendance, Export, Settings) so actions are findable without scrolling through a flat list.

**Pull-to-refresh tightening**  
The pull indicator CSS already exists. Tighten the UX so the spinner appears immediately on pull and completes with a brief success flash.

---

## 3. New Features

**Attendance trend chart**  
Line chart (Chart.js, already loaded) showing last 8 weeks of attendance per group. Placed above the check-in button in admin view. Tapping a data point navigates to the Attendance tab filtered to that week.

**Weekly comparison widget**  
Compact row below the chart: "This week: 24 ↑ +3 from last week" per group. Gives leaders an instant read without opening the attendance table.

**Member search + group filter**  
Search bar with 동산 filter pills below it. Pills narrow the list; text search works simultaneously. Example: type "김" + select "동산2" to filter both at once.

**Export dropdown**  
Replace separate export buttons with a single dropdown: "Download CSV (log)", "Download CSV (grid)", "Download HTML report". Lives in the admin panel Export section.

---

## 4. Deployment Architecture

### GitHub Pages (frontend)

A GitHub Actions workflow (`deploy.yml`) triggers on push to `main`:
- Copies `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` to the `gh-pages` branch
- Site live at: `https://shrlak.github.io/kccp-attendance/`

### API Base URL

The frontend currently uses relative `/api/...` paths. Update to use an absolute base URL pointing to the Oracle server:
```
const API_BASE = 'http://158.101.118.21:3000';
```
All fetch calls updated from `/api/foo` to `${API_BASE}/api/foo`.

### CORS (server.js)

Add CORS response headers to `server.js` to accept requests from `https://shrlak.github.io`:
```
Access-Control-Allow-Origin: https://shrlak.github.io
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```
Handle `OPTIONS` preflight requests with a 204 response.

### Service Worker Scope

Update `sw.js` cache paths and scope to work under the `/kccp-attendance/` subpath that GitHub Pages uses. Update the `start_url` in `manifest.json` accordingly.

### Local Cleanup

After the GitHub push is confirmed and GitHub Actions succeeds:
- Delete the entire local project folder: `/Users/shrla/downloads/kccp-attendance`

### Backend (unchanged)

`server.js` continues to run on Oracle server at `158.101.118.21:3000`. This deployment does **not** move or change the backend beyond adding CORS headers.

---

## Constraints & Notes

- Keep single-file SPA architecture (`index.html`) — no build pipeline introduced
- All changes to `index.html` must preserve all existing functionality
- `data/` JSON files, SSH keys, and `.env` equivalents never committed to GitHub (already in `.gitignore`)
- The admin password `kccpwelcome` is hardcoded in `server.js` — noted as a pre-existing risk, out of scope for this pass
- GitHub remote already configured: `github.com/shrlak/kccp-attendance`
