import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from a GitHub Project Pages subpath (https://shrlak.github.io/kccp-attendance/),
// so assets, the router basename, and the PWA scope must all be prefixed with it — a
// root-based ('/') build 404s every asset under the subpath and renders blank.
const base = '/kccp-attendance/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate', // fixes the stale-cache class of bug (legacy #37)
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'KCCP 출석',
        short_name: 'KCCP 출석',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#D9603D',
        background_color: '#FBF7F0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
