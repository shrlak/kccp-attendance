import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from a GitHub Project Pages subpath (https://shrlak.github.io/kccp-attendance/),
// so assets, the router basename, and the PWA scope must all be prefixed with it — a
// root-based ('/') build 404s every asset under the subpath and renders blank.
const base = '/kccp-attendance/'

const icons = [
  { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
]

// https://vite.dev/config/
export default defineConfig({
  base,
  build: {
    // The lazily-loaded heavyweights (SheetJS, Chart.js) legitimately exceed the default
    // 500 kB warning; the route chunks are what we actually watch, and they're far under it.
    chunkSizeWarningLimit: 900,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A hand-written worker (src/sw.ts) rather than a generated one: the Web Share Target
      // contract needs a `fetch` handler for the POST the OS sends when someone shares a
      // photo into the app, which generateSW can't express. Everything the generated worker
      // did (precache + auto-update) is reproduced there.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate', // fixes the stale-cache class of bug (legacy #37)
      includeAssets: ['icon-192.png', 'icon-512.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // SheetJS (~860 kB) and Chart.js (~200 kB) load only when someone exports or opens
        // 분석, so precaching them would re-download ~1 MB on every deploy for features most
        // sessions never touch. sw.ts runtime-caches them on first use instead.
        globIgnores: ['**/xlsx*', '**/chart-*'],
      },
      manifest: {
        name: 'KCCP 출석',
        short_name: 'KCCP 출석',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        icons,
        // Long-press the home-screen icon → jump straight to card registration or the
        // kiosk, skipping the landing page and the walk through the 새가족 tab.
        shortcuts: [
          { name: '새가족 카드 등록', short_name: '카드 등록', url: `${base}share`, icons },
          { name: '교회 키오스크', short_name: '키오스크', url: `${base}kiosk`, icons },
        ],
        // Web Share Target: registers the installed app in the phone's share sheet, so a
        // 새가족 카드 photo goes 사진 앱 → 공유 → KCCP 출석 without opening the site and
        // walking to 새가족 → 카드 사진 등록. The OS POSTs the files here; sw.ts answers.
        share_target: {
          action: `${base}share`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'photos',
                accept: ['image/*', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
              },
            ],
          },
        },
      },
    }),
  ],
})
