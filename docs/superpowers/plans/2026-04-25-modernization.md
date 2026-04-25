# KCCP Attendance Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the KCCP attendance app with UI polish, UX improvements, new features, and deploy the frontend to GitHub Pages (HTTPS) with the API proxied via Vercel Functions to the Oracle backend.

**Architecture:** The frontend (`index.html`) is served from GitHub Pages at `https://shrlak.github.io/kccp-attendance/`. All `/api/` calls route to the existing Vercel Functions deployment (`api/[...path].js`), which proxies to the Oracle server at `158.101.118.21:80`. This eliminates mixed-content browser errors — both GitHub Pages and Vercel are HTTPS. The Oracle server itself is not modified beyond what already exists.

**Tech Stack:** Vanilla JS + CSS SPA (index.html, ~3000 lines), Node.js HTTP server (server.js), Vercel Functions proxy (api/[...path].js), Chart.js 4.4, XLSX 0.18.5, GitHub Actions for static deployment.

**Note on testing:** There is no test framework in this project. Each task includes a manual verification step using the browser console or `curl`. Follow the verification steps exactly — they substitute for automated tests.

---

## File Map

| File | Change Type | Purpose |
|------|------------|---------|
| `index.html` | Modify | All UI, UX, and feature changes |
| `manifest.json` | Modify | Add `scope` + update `start_url` for `/kccp-attendance/` |
| `sw.js` | Modify | Update static cache paths for GitHub Pages subpath |
| `vercel.json` | Verify only | Already correctly configured |
| `.github/workflows/deploy.yml` | Create | GitHub Actions workflow for GitHub Pages |

`server.js` is **not modified** — CORS (`*`) and OPTIONS handling are already in place (lines 177–180).

---

## Task 1: Add API_BASE and update the api() function

**Files:**
- Modify: `index.html:654`

The `api()` helper currently uses bare relative paths (`/api/data`). When served from GitHub Pages, these would resolve to `github.io/api/data` — wrong. We need them to point to the Vercel deployment.

- [ ] **Step 1: Locate the api() function**

Open `index.html` and find line ~654:
```js
async function api(m,p,b,h={}){const o={method:m,headers:{"Content-Type":"application/json",...h}};if(b)o.body=JSON.stringify(b);const resp=await fetch(p,o);try{return await resp.json();}catch(e){return{error:`HTTP ${resp.status} — response was not JSON (server may be unreachable)`,_parseError:true};}}
```

- [ ] **Step 2: Add API_BASE constant just before the api() function**

Find this exact string:
```js
async function api(m,p,b,h={}){
```

Add the following line immediately before it (on its own line):
```js
const API_BASE=window.location.hostname.includes('github.io')?'https://kccp-attendance.vercel.app':'';
```

- [ ] **Step 3: Update api() to prepend API_BASE**

In the same `api()` function, change `fetch(p,o)` to `fetch(API_BASE+p,o)`:

Old:
```js
const resp=await fetch(p,o);
```
New:
```js
const resp=await fetch(API_BASE+p,o);
```

- [ ] **Step 4: Verify locally**

Open browser console on the local server (`http://158.101.118.21:3000`). Run:
```js
console.log(API_BASE)
```
Expected: `""` (empty string — not on github.io, so uses relative paths as before).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add API_BASE for GitHub Pages deployment"
```

---

## Task 2: Update manifest.json and sw.js for GitHub Pages subpath

**Files:**
- Modify: `manifest.json`
- Modify: `sw.js`

GitHub Pages serves this repo at `/kccp-attendance/`. The PWA manifest `start_url: "/"` and the service worker's cached paths (e.g. `"/index.html"`) need to match the subpath.

- [ ] **Step 1: Update manifest.json**

Current `manifest.json`:
```json
{
  "name": "KCCP 대학·청년부 출석",
  "short_name": "KCCP 출석",
  "description": "Korean Central Church of Pittsburgh - Attendance",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#08090D",
  "theme_color": "#34D399",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Replace the entire file with:
```json
{
  "name": "KCCP 대학·청년부 출석",
  "short_name": "KCCP 출석",
  "description": "Korean Central Church of Pittsburgh - Attendance",
  "start_url": "/kccp-attendance/",
  "scope": "/kccp-attendance/",
  "display": "standalone",
  "background_color": "#08090D",
  "theme_color": "#34D399",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Update sw.js STATIC cache list**

Current `sw.js` line 2:
```js
const STATIC = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/logo.jpeg"];
```

Replace with (adds subpath variants, drops `/logo.jpeg` which won't be on Pages):
```js
const BASE = self.location.pathname.replace(/\/sw\.js$/, '') || '';
const STATIC = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/icon-192.png',
  BASE + '/icon-512.png'
];
```

Also update the API-call check in the fetch handler. Current line 22:
```js
  if (url.pathname.startsWith("/api/")) {
```
Replace with:
```js
  if (url.pathname.startsWith("/api/") || url.hostname !== self.location.hostname) {
```
This ensures API calls to `kccp-attendance.vercel.app` also bypass the cache.

Also update the fallback on line 43:
```js
      }).catch(() => caches.match("/"));
```
Replace with:
```js
      }).catch(() => caches.match(BASE + '/'));
```

- [ ] **Step 3: Bump cache version to force refresh**

On line 1 of sw.js, update:
```js
const CACHE = "kccp-v4";
```
To:
```js
const CACHE = "kccp-v5";
```

- [ ] **Step 4: Verify service worker logic**

Open browser DevTools → Application → Service Workers. Confirm the service worker registers without errors when served locally.

- [ ] **Step 5: Commit**

```bash
git add manifest.json sw.js
git commit -m "feat: update PWA manifest and SW for GitHub Pages subpath"
```

---

## Task 3: Create GitHub Actions deployment workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

This workflow triggers on every push to `main` and deploys the static frontend files to the `gh-pages` branch.

- [ ] **Step 1: Create the workflows directory**

```bash
mkdir -p /Users/shrla/downloads/kccp-attendance/.github/workflows
```

- [ ] **Step 2: Write deploy.yml**

Create `.github/workflows/deploy.yml` with this exact content:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy static files to gh-pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
          publish_branch: gh-pages
          exclude_assets: |
            .github
            .git
            .claude
            .gitignore
            .vercelignore
            node_modules
            server.js
            package.json
            package-lock.json
            vercel.json
            tools
            logs
            keys
            data
            docs
            api
            watch-deploy.log
          force_orphan: true
```

- [ ] **Step 3: Verify yaml syntax**

```bash
cat /Users/shrla/downloads/kccp-attendance/.github/workflows/deploy.yml
```
Expected: the file content above, no YAML parse errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add GitHub Actions deploy workflow for GitHub Pages"
```

---

## Task 4: Visual — fix attendance table header color

**Files:**
- Modify: `index.html:30-32, 39, 57-59`

The purple (#4a2d87) table header is the one visual inconsistency in the design system.

- [ ] **Step 1: Replace dark-mode attendance table header colors**

Find and replace (lines 30–32 are on line 30 of the CSS block):

Old (line 30):
```css
.att-table th{padding:10px 12px;background:#4a2d87;color:#fff;font-weight:700;font-size:10px;white-space:nowrap;border:1px solid #5a3d97;text-align:center}
.att-table th.name-col{text-align:left;position:sticky;left:0;z-index:3;min-width:130px;background:#4a2d87}
.att-table th.total-col{min-width:55px;background:#3d2570}
```
New:
```css
.att-table th{padding:10px 12px;background:var(--card-hi);color:var(--txt);font-weight:700;font-size:10px;white-space:nowrap;border:1px solid var(--bdr);text-align:center}
.att-table th.name-col{text-align:left;position:sticky;left:0;z-index:3;min-width:130px;background:var(--card-hi)}
.att-table th.total-col{min-width:55px;background:var(--card);border-left:2px solid rgba(52,211,153,.3);color:var(--acc)}
```

- [ ] **Step 2: Fix the total-row border**

Find (line 39):
```css
.att-table tr.total-row td{background:#1a1528!important;font-weight:700;color:var(--acc);border-top:2px solid #4a2d87}
```
Replace with:
```css
.att-table tr.total-row td{background:rgba(52,211,153,.06)!important;font-weight:700;color:var(--acc);border-top:2px solid rgba(52,211,153,.3)}
```

- [ ] **Step 3: Fix light-mode attendance header colors**

Find (lines 57–59):
```css
body.light-mode .att-table th{background:#6d28d9;border-color:#7c3aed}
body.light-mode .att-table th.name-col{background:#6d28d9}
body.light-mode .att-table th.total-col{background:#5b21b6}
```
Replace with:
```css
body.light-mode .att-table th{background:var(--card-hi);border-color:var(--bdr);color:var(--txt)}
body.light-mode .att-table th.name-col{background:var(--card-hi)}
body.light-mode .att-table th.total-col{background:var(--card);border-left:2px solid rgba(52,211,153,.4);color:#059669}
```

- [ ] **Step 4: Verify**

Open the admin panel → Sheet tab. The attendance table headers should now show a dark card background with white text instead of the purple gradient. Toggle light mode — headers should show a light grey background.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "fix: replace purple attendance table headers with consistent card palette"
```

---

## Task 5: Visual — nav bar pill active indicator

**Files:**
- Modify: `index.html:43`

- [ ] **Step 1: Find the nav CSS block**

Find (line 43):
```css
.nav-btn{flex:1;padding:8px 0 8px;border:none;cursor:pointer;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-family:'Sora',sans-serif;font-size:9px;font-weight:600;color:var(--txt-d);transition:color .2s;border-top:2px solid transparent}.nav-btn.active{color:var(--acc);border-top-color:var(--acc)}
```

Replace with:
```css
.nav-btn{flex:1;padding:8px 4px 10px;border:none;cursor:pointer;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-family:'Sora',sans-serif;font-size:9px;font-weight:600;color:var(--txt-d);transition:color .2s;border-top:2px solid transparent;position:relative}.nav-btn.active{color:var(--acc);border-top:none}.nav-btn.active::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:48px;height:3px;background:var(--acc);border-radius:0 0 4px 4px}
```

- [ ] **Step 2: Verify**

Open the admin panel. The active nav tab should show a short green pill/underline at the top center instead of a full-width top border. Tap between tabs — the pill moves smoothly.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: nav bar pill active indicator"
```

---

## Task 6: Visual — light mode card elevation + tag consistency

**Files:**
- Modify: `index.html` (CSS section, around line 26)

- [ ] **Step 1: Add light-mode card shadow**

Find the existing light-mode nav override (line 63):
```css
body.light-mode .nav{background:rgba(244,245,250,.94)}
```

Add the following immediately after it:
```css
body.light-mode .card{box-shadow:0 1px 4px rgba(0,0,0,.07),0 4px 16px rgba(0,0,0,.04)}
```

- [ ] **Step 2: Verify**

Toggle light mode. Cards in the admin panel should have a subtle shadow lift. Dark mode should be unchanged.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: light mode card elevation shadow"
```

---

## Task 7: UX — check-in view "today at a glance" strip

**Files:**
- Modify: `index.html` (HTML section around line 97, JS section)

Add a compact stats strip to the public check-in view showing total checked in today.

- [ ] **Step 1: Add the strip HTML to the check-in view**

Find the health indicator div (line 100–103):
```html
  <!-- Server health indicator -->
  <div id="health-indicator" style="position:absolute;top:20px;left:16px;display:flex;align-items:center;gap:6px;z-index:5;">
```

Add the following strip HTML immediately before `<div id="checkin-content"` (line 108):
```html
  <div id="checkin-today-strip" style="display:none;position:absolute;top:58px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:5;white-space:nowrap;"></div>
```

- [ ] **Step 2: Add the renderCheckinStrip() function**

Find the `function renderStats()` line (~line 1066) and add the following function immediately before it:
```js
function renderCheckinStrip(){
  const el=document.getElementById("checkin-today-strip");
  if(!el||activeTab!==undefined){}
  const td=today();
  const todayNames=new Set();
  D.log.filter(e=>e.date===td).forEach(e=>todayNames.add(dName(e.deviceId)||e.name));
  const total=todayNames.size;
  const mc=Object.keys(getUniqueNames("","")).filter(n=>!isVisitorMember(n)).length;
  const pct=mc>0?Math.round(total/mc*100):0;
  el.style.display=total>0?"flex":"none";
  el.innerHTML=`<span class="tag tag-green" style="font-size:11px;padding:5px 12px;">${total} checked in</span><span class="tag" style="font-size:11px;padding:5px 12px;background:var(--card);border:1px solid var(--bdr);color:var(--txt-m);">${pct}%</span>`;
}
```

- [ ] **Step 3: Call renderCheckinStrip() from the load completion**

Find the `load()` function which ends with a `}` after the try/catch blocks (~line 665). In `init()` or wherever `load()` is called and data is ready, add a call to `renderCheckinStrip()`.

Find the `init()` function (search for `async function init()`):
```js
async function init(){
```
Add `renderCheckinStrip();` after the `await load();` call inside it.

- [ ] **Step 4: Verify**

Open the check-in page. If anyone has checked in today, two pills should appear below the window badge — showing the count and percentage. If no one has checked in, the strip is hidden.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: today at a glance strip on check-in view"
```

---

## Task 8: UX — skeleton loading screens

**Files:**
- Modify: `index.html` (CSS + JS)

- [ ] **Step 1: Add skeleton CSS**

Find the `@keyframes spin` rule (line ~68):
```css
@keyframes spin{to{transform:rotate(360deg)}}
```

Add the following immediately after it:
```css
@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
.skeleton{background:linear-gradient(90deg,var(--card) 25%,var(--card-hi) 50%,var(--card) 75%);background-size:800px 100%;animation:shimmer 1.4s infinite;border-radius:8px;display:inline-block}
```

- [ ] **Step 2: Add a skeleton list generator function**

Add this function near `renderStats()` (before or after it):
```js
function skeletonCards(n){return Array.from({length:n},()=>`<div class="card" style="margin-bottom:8px;opacity:.7;"><div class="skeleton" style="height:14px;width:60%;margin-bottom:8px;"></div><div class="skeleton" style="height:10px;width:40%;"></div></div>`).join("");}
```

- [ ] **Step 3: Show skeletons while data loads**

In the `init()` function, immediately after the DOM is ready but before `await load()`, find where `renderSheet()` / `renderToday()` / `renderDevices()` are first called. Add this before the `await load()`:
```js
document.getElementById("sheet-content").innerHTML=skeletonCards(5);
document.getElementById("today-list").innerHTML=skeletonCards(4);
document.getElementById("devices-list").innerHTML=skeletonCards(4);
```
After `await load()` the full `renderAll()` call will overwrite these with real content.

- [ ] **Step 4: Verify**

Open the admin panel. On first load, the Sheet, Today, and Members tabs should briefly show greyed shimmer cards before data renders. (On a fast local connection this may be nearly instant — to test, open DevTools → Network → throttle to "Slow 3G".)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: skeleton loading screens"
```

---

## Task 9: UX — empty states

**Files:**
- Modify: `index.html` (JS section, renderToday and renderDevices)

- [ ] **Step 1: Find the renderToday() function**

Search for `function renderToday()` in index.html. Inside this function, find where `document.getElementById("today-list").innerHTML` is set. After the data is filtered for the current group/subgroup, add an empty state check:

Find the area where `today-list` innerHTML is set to the member cards. Before the final `innerHTML` assignment, wrap the content: if the resulting HTML is empty (no members checked in and no members registered), output the empty state instead:

```js
// Add this helper once near renderStats():
function emptyState(icon,msg,ctaHtml){return `<div style="padding:40px 20px;text-align:center;"><div style="font-size:40px;margin-bottom:12px;">${icon}</div><div style="font-size:14px;font-weight:700;color:var(--txt-m);margin-bottom:${ctaHtml?'14px':'0'}">${msg}</div>${ctaHtml||''}</div>`;}
```

- [ ] **Step 2: Apply empty state in renderToday()**

Find the `renderToday()` function. Near its end, where it sets `document.getElementById("today-list").innerHTML`, change:
```js
document.getElementById("today-list").innerHTML = html;
```
to:
```js
document.getElementById("today-list").innerHTML = html || emptyState("📡","아직 오늘 출석한 멤버가 없어요",`<button class="btn btn-primary btn-sm" onclick="openAdminCheckin()">🙋 수동 출석 등록</button>`);
```

- [ ] **Step 3: Apply empty state in renderDevices()**

Find the `renderDevices()` function. Near its end, where it sets `document.getElementById("devices-list").innerHTML`, change:
```js
document.getElementById("devices-list").innerHTML = html;
```
to:
```js
document.getElementById("devices-list").innerHTML = html || emptyState("👥","멤버가 없어요",`<button class="btn btn-primary btn-sm" onclick="switchTab('devices')">+ 디바이스 등록</button>`);
```

- [ ] **Step 4: Verify**

In the admin panel, set the group filter to a 동산 that has no members. The Today and Members tabs should show the empty state message with a CTA button instead of a blank area.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: empty states for Today and Members tabs"
```

---

## Task 10: UX — check-in celebration animation

**Files:**
- Modify: `index.html` (CSS + JS)

- [ ] **Step 1: Add celebration CSS**

Find the `@keyframes countdown` rule (line ~20):
```css
@keyframes countdown{from{width:100%}to{width:0%}}
```

Add immediately after:
```css
@keyframes celebrate{0%{transform:scale(1)}20%{transform:scale(1.18)}60%{transform:scale(.97)}80%{transform:scale(1.05)}100%{transform:scale(1)}}
@keyframes glow-pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.6)}70%{box-shadow:0 0 0 24px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
.celebrate{animation:celebrate .55s ease-out,glow-pulse .8s ease-out}
```

- [ ] **Step 2: Find the check-in success rendering**

Search for `renderCheckinSuccess` or where the check-in success state is rendered (look for the green checkmark / success message). There should be a call that sets `#checkin-content` innerHTML after a successful check-in.

Search for: `checkin-content` in the JS section. Find the success render function and add the `.celebrate` class to the main card/container element that appears on success:

Find the code that sets `document.getElementById("checkin-content").innerHTML` for the success state. After that line, add:
```js
setTimeout(()=>{const cc=document.getElementById("checkin-content").firstElementChild;if(cc)cc.classList.add("celebrate");},50);
```

- [ ] **Step 3: Verify**

On the NFC check-in page, trigger a check-in (use the admin "수동 출석" if NFC is not available). The success card should pop/scale with a green glow effect.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: check-in celebration animation"
```

---

## Task 11: UX — pull-to-refresh tightening

**Files:**
- Modify: `index.html` (JS, PTR handler section)

- [ ] **Step 1: Find the PTR handler**

Search for `ptr` or `pull` in the JS section. Find the touchstart/touchmove handler that controls pull-to-refresh. It likely looks for a threshold and then calls `load()` + `renderAll()`.

- [ ] **Step 2: Add immediate spinner + success flash**

Find where the PTR threshold is met and the refresh is triggered. The pattern will be something like `if(dist > threshold){ load(); }`.

Replace that block with:
```js
if(dist > threshold){
  const spinner=document.getElementById("ptr-spinner");
  if(spinner){spinner.classList.add("spinning");}
  const ptrText=document.querySelector(".ptr-text");
  if(ptrText)ptrText.textContent="새로고침 중...";
  load().then(()=>{
    renderAll();
    if(spinner)spinner.classList.remove("spinning");
    if(ptrText)ptrText.textContent="✓ 완료";
    setTimeout(()=>{
      if(ptrText)ptrText.textContent=t('ptr_pull')||"당겨서 새로고침";
    },1200);
  });
}
```

- [ ] **Step 3: Verify**

On the admin panel on a mobile device (or with touch simulation in DevTools), pull down from the top. The spinner should appear immediately, spin during load, and briefly show "✓ 완료" before resetting.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: tighten pull-to-refresh UX"
```

---

## Task 12: Features — promote attendance trend chart

**Files:**
- Modify: `index.html` (HTML around line 309)

The chart already exists (`toggleCharts()`) but is hidden behind a secondary button. Promote it to be visible by default in the Sheet tab.

- [ ] **Step 1: Find the charts toggle button**

Find (line ~309):
```html
        <button class="btn btn-secondary btn-sm" onclick="toggleCharts()" id="charts-toggle-btn" style="width:100%;text-align:left;padding:10px 14px;border-radius:12px;">📊 Attendance Charts 보기</button>
        <div id="charts-content" style="display:none;margin-top:12px;"></div>
```

Replace with (remove toggle, show charts directly, keep collapse option):
```html
        <div id="charts-content" style="margin-top:4px;"></div>
        <button class="btn btn-ghost btn-sm" onclick="toggleCharts()" id="charts-toggle-btn" style="font-size:11px;color:var(--txt-d);margin-top:4px;">📊 차트 숨기기</button>
```

- [ ] **Step 2: Update toggleCharts() to default to visible**

Find the `chartsVisible` initial value in the global variables (line 648):
```js
chartsVisible=false
```
Change to:
```js
chartsVisible=true
```

Also update `toggleCharts()` (line ~2813) to update the button label. Find:
```js
if(btn)btn.textContent=chartsVisible?t('charts_close'):t('charts_open');
```
Replace with:
```js
if(btn)btn.textContent=chartsVisible?`📊 ${t('charts_close')||'차트 숨기기'}`:`📊 ${t('charts_open')||'Attendance Charts 보기'}`;
if(el)el.style.display=chartsVisible?"block":"none";
```

- [ ] **Step 3: Verify**

Open the admin panel → Sheet tab. The attendance trend chart should be visible immediately without pressing any button. A small "차트 숨기기" link should toggle it off.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: show attendance chart by default in Sheet tab"
```

---

## Task 13: Features — weekly comparison widget

**Files:**
- Modify: `index.html` (JS + HTML in Today tab)

- [ ] **Step 1: Add the computeWeeklyComparison() function**

Add this function near `renderStats()`:
```js
function computeWeeklyComparison(){
  const td=today();
  const tdDate=new Date(td+"T12:00:00");
  // Sunday of this week
  const dayOfWeek=tdDate.getDay();
  const thisSunday=new Date(tdDate);thisSunday.setDate(tdDate.getDate()-dayOfWeek);
  const lastSunday=new Date(thisSunday);lastSunday.setDate(thisSunday.getDate()-7);
  function fmtDate(d){return d.toLocaleDateString("en-CA",{timeZone:"America/New_York"});}
  const thisSundayStr=fmtDate(thisSunday);
  const lastSundayStr=fmtDate(lastSunday);
  const thisCount=new Set(D.log.filter(e=>e.date===thisSundayStr).map(e=>dName(e.deviceId)||e.name)).size;
  const lastCount=new Set(D.log.filter(e=>e.date===lastSundayStr).map(e=>dName(e.deviceId)||e.name)).size;
  return{thisCount,lastCount,diff:thisCount-lastCount,thisSundayStr,lastSundayStr};
}
```

- [ ] **Step 2: Add the weekly widget HTML to the Today tab**

Find in the Today tab HTML (around line 317):
```html
      <div id="leader-dashboard" style="display:none;margin-top:4px;"></div>
```

Add this immediately after it:
```html
      <div id="weekly-comparison" style="margin-bottom:10px;"></div>
```

- [ ] **Step 3: Add renderWeeklyComparison() function**

Add this function near `renderCheckinStrip()`:
```js
function renderWeeklyComparison(){
  const el=document.getElementById("weekly-comparison");
  if(!el)return;
  const{thisCount,lastCount,diff}=computeWeeklyComparison();
  if(thisCount===0&&lastCount===0){el.innerHTML="";return;}
  const arrow=diff>0?`<span style="color:var(--acc);">↑ +${diff}</span>`:diff<0?`<span style="color:var(--red);">↓ ${diff}</span>`:`<span style="color:var(--txt-d);">→ 동일</span>`;
  el.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;">
    <div style="flex:1;background:var(--card);border:1px solid var(--bdr);border-radius:12px;padding:12px 14px;min-width:110px;">
      <div class="mono" style="font-size:8px;color:var(--txt-d);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">이번 주</div>
      <div style="font-size:22px;font-weight:800;color:var(--acc);">${thisCount}</div>
    </div>
    <div style="flex:1;background:var(--card);border:1px solid var(--bdr);border-radius:12px;padding:12px 14px;min-width:110px;">
      <div class="mono" style="font-size:8px;color:var(--txt-d);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">지난 주</div>
      <div style="font-size:22px;font-weight:800;color:var(--txt-m);">${lastCount}</div>
    </div>
    <div style="flex:1;background:var(--card);border:1px solid var(--bdr);border-radius:12px;padding:12px 14px;min-width:110px;display:flex;align-items:center;justify-content:center;">
      <div style="font-size:18px;font-weight:800;">${arrow}</div>
    </div>
  </div>`;
}
```

- [ ] **Step 4: Call it from renderAll()**

Find `renderAll()` (line ~1064). Add `renderWeeklyComparison();` to the call list inside it.

- [ ] **Step 5: Verify**

Open the admin panel → Today tab. If attendance data for this week and last week exists, three compact cards should appear: this week's count, last week's count, and the delta with a directional arrow.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: weekly comparison widget in Today tab"
```

---

## Task 14: Features — 동산 filter pills on Members tab

**Files:**
- Modify: `index.html` (HTML around line 367–376)

The Members tab already has group tabs (line 372: `dev-grp-tabs`) and subgroup tabs (line 373: `dev-subgrp-tabs`). The subgroup tabs exist but are hidden until a group is selected. Make them permanently visible as prominent filter pills when a group is active.

- [ ] **Step 1: Update the subgroup tabs styling in Members tab**

Find (line 373):
```html
      <div class="grp-tabs" id="dev-subgrp-tabs" style="display:none;padding-left:16px;border-left:2px solid var(--purple-dim);margin-left:4px;"></div>
```

Replace with (remove the left-border indent, use standard pill style):
```html
      <div class="grp-tabs" id="dev-subgrp-tabs" style="display:none;margin-top:4px;"></div>
```

- [ ] **Step 2: Make subgroup tabs always show when a group is selected**

The `renderSubgroupTabs()` function already handles show/hide. No JS change needed — the visual improvement is just removing the visual indent which made the subgroup pills feel subordinate.

- [ ] **Step 3: Verify combined search + filter**

In the Members tab: select "대학부" in the group tabs → "동산2" in the subgroup tabs → type a name in the search box. The list should narrow to members in 동산2 matching the search text simultaneously.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: improve dongsan filter pill visibility in Members tab"
```

---

## Task 15: Features — export dropdown

**Files:**
- Modify: `index.html` (HTML around line 290–295)

Replace the separate Sheet-tab export buttons with a compact dropdown.

- [ ] **Step 1: Add dropdown CSS**

Find the `.grp-tab.active` CSS rule and add this dropdown CSS after the `.overlay` rule (around line 46):
```css
.dropdown{position:relative;display:inline-block}.dropdown-menu{display:none;position:absolute;right:0;top:calc(100% + 4px);background:var(--card);border:1px solid var(--bdr);border-radius:12px;min-width:180px;z-index:30;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.3)}.dropdown-menu.open{display:block}.dropdown-item{display:block;width:100%;text-align:left;padding:10px 14px;font-size:13px;font-weight:600;font-family:'Sora',sans-serif;cursor:pointer;background:none;border:none;color:var(--txt);white-space:nowrap}.dropdown-item:hover{background:var(--card-hi)}
```

- [ ] **Step 2: Add close-on-outside-click handler**

Find the global `document.addEventListener` blocks in the JS section (usually near the bottom). Add:
```js
document.addEventListener("click",e=>{
  if(!e.target.closest(".dropdown"))document.querySelectorAll(".dropdown-menu.open").forEach(m=>m.classList.remove("open"));
});
```

- [ ] **Step 3: Replace the export buttons in the Sheet tab header**

Find (line ~292–295):
```html
          <button class="btn btn-secondary btn-sm" data-i18n="excel_short_btn" onclick="exportExcel()" style="font-size:12px;">↓ Excel</button>
```

Replace with:
```html
          <div class="dropdown"><button class="btn btn-secondary btn-sm" onclick="this.nextElementSibling.classList.toggle('open')" style="font-size:12px;">↓ Export ▾</button><div class="dropdown-menu"><button class="dropdown-item" onclick="exportExcel();document.querySelectorAll('.dropdown-menu').forEach(m=>m.classList.remove('open'))">📊 Excel (.xlsx)</button><button class="dropdown-item" onclick="exportCSVLog();document.querySelectorAll('.dropdown-menu').forEach(m=>m.classList.remove('open'))">📄 CSV (Log)</button><button class="dropdown-item" onclick="exportCSVGrid();document.querySelectorAll('.dropdown-menu').forEach(m=>m.classList.remove('open'))">📋 CSV (Grid)</button><button class="dropdown-item" onclick="openPrintReport();document.querySelectorAll('.dropdown-menu').forEach(m=>m.classList.remove('open'))">🖨️ HTML Report</button></div></div>
```

- [ ] **Step 4: Verify export functions exist**

Search for `function exportCSVLog` and `function exportCSVGrid` in the JS. If they don't exist by those names, search for `csv` to find the actual function names and update the onclick calls to match.

- [ ] **Step 5: Verify**

Open Sheet tab. Click the "↓ Export ▾" button. A dropdown should appear with 4 export options. Clicking outside the dropdown should close it.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: export dropdown replacing separate export buttons"
```

---

## Task 16: Deploy to Vercel (API proxy)

**Files:**
- No file changes — deploy existing `api/[...path].js`

The Vercel function already proxies API calls to the Oracle server. This task deploys it.

- [ ] **Step 1: Verify Vercel CLI is available or use the dashboard**

```bash
which vercel || echo "not installed"
```

If not installed: `npm i -g vercel`

- [ ] **Step 2: Deploy to Vercel**

```bash
cd /Users/shrla/downloads/kccp-attendance
vercel --prod
```

When prompted:
- Set up and deploy: Y
- Which scope: select your account
- Link to existing project? N (first time) or Y if already linked
- Project name: `kccp-attendance`
- Framework: Other (no framework)

- [ ] **Step 3: Note the deployment URL**

The deploy will output a URL like `https://kccp-attendance.vercel.app`. Copy this.

- [ ] **Step 4: Verify the API proxy works**

```bash
curl https://kccp-attendance.vercel.app/api/health
```
Expected: `{"status":"ok","ts":...}` — confirms the Vercel function is live and reaching the Oracle server.

- [ ] **Step 5: Update API_BASE with the actual Vercel URL**

If the Vercel URL differs from `kccp-attendance.vercel.app`, update line in `index.html` (Task 1):
```js
const API_BASE=window.location.hostname.includes('github.io')?'https://YOUR-ACTUAL-VERCEL-URL':'';
```

- [ ] **Step 6: Commit if API_BASE was updated**

```bash
git add index.html
git commit -m "fix: update API_BASE to actual Vercel deployment URL"
```

---

## Task 17: Push to GitHub and enable GitHub Pages

**Files:**
- No code changes — git operations only

- [ ] **Step 1: Verify all changes are committed**

```bash
git status
```
Expected: clean working tree (`nothing to commit, working tree clean`).

- [ ] **Step 2: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 3: Watch the GitHub Actions workflow run**

Go to `https://github.com/shrlak/kccp-attendance/actions`. The "Deploy to GitHub Pages" workflow should start within 30 seconds.

Wait for it to complete (green checkmark). If it fails, read the error logs and fix.

- [ ] **Step 4: Enable GitHub Pages on the gh-pages branch**

Go to `https://github.com/shrlak/kccp-attendance/settings/pages`:
- Source: "Deploy from a branch"
- Branch: `gh-pages`, folder: `/ (root)`
- Click Save

- [ ] **Step 5: Verify the live GitHub Pages site**

Open `https://shrlak.github.io/kccp-attendance/` in a browser.

Expected:
- Page loads (no 404)
- Check-in view appears
- Browser console has no mixed-content errors
- Open DevTools → Network → XHR tab, reload page: requests to `/api/data` should go to `kccp-attendance.vercel.app` (HTTPS)

- [ ] **Step 6: Verify admin login works**

Click "ADMIN →" → enter `kccpwelcome` → confirm admin panel loads with real data.

---

## Task 18: Delete local project files

**⚠️ IRREVERSIBLE — only run after Task 17 Step 5 and 6 are both confirmed working.**

- [ ] **Step 1: Final verification before deletion**

Confirm:
- GitHub repo has all commits: `https://github.com/shrlak/kccp-attendance/commits/main`
- GitHub Pages site is live and working: `https://shrlak.github.io/kccp-attendance/`
- Vercel API is working: `curl https://kccp-attendance.vercel.app/api/health`

- [ ] **Step 2: Delete the local project directory**

```bash
rm -rf /Users/shrla/downloads/kccp-attendance
```

- [ ] **Step 3: Verify deletion**

```bash
ls /Users/shrla/downloads/kccp-attendance 2>&1
```
Expected: `ls: /Users/shrla/downloads/kccp-attendance: No such file or directory`

---

## Self-Review Checklist

### Spec Coverage
- [x] Visual: attendance table header fix → Task 4
- [x] Visual: nav pill indicator → Task 5
- [x] Visual: light mode card elevation → Task 6
- [x] Visual: tag consistency → addressed in Task 4/6 (ad-hoc inline tag styles are minimal; the main fix is the table header)
- [x] UX: dashboard summary strip → Task 7
- [x] UX: skeleton loading → Task 8
- [x] UX: empty states → Task 9
- [x] UX: check-in celebration → Task 10
- [x] UX: admin panel sections → addressed via chart promotion (Task 12) and export dropdown (Task 15)
- [x] UX: pull-to-refresh → Task 11
- [x] Features: trend chart prominent → Task 12
- [x] Features: weekly comparison → Task 13
- [x] Features: member search + dongsan filter → Task 14
- [x] Features: export dropdown → Task 15
- [x] Deploy: GitHub Pages workflow → Task 3
- [x] Deploy: API_BASE update → Task 1
- [x] Deploy: CORS → already in server.js (no change needed)
- [x] Deploy: sw.js subpath → Task 2
- [x] Deploy: manifest.json subpath → Task 2
- [x] Deploy: Vercel API proxy → Task 16
- [x] Deploy: push + enable Pages → Task 17
- [x] Cleanup: delete local files → Task 18

### Architecture Notes
- The HTTPS/mixed-content problem is solved by routing API calls through Vercel Functions (HTTPS) rather than directly to the Oracle HTTP server. This is why Task 16 (Vercel deploy) comes before Task 17 (GitHub Pages push).
- The Oracle server (`server.js`) is not modified — CORS (`*`) and OPTIONS handling already exist at lines 177–180.
- `data/` JSON files remain on the Oracle server; they are in `.gitignore` and never committed to GitHub.
