import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate', // fixes the stale-cache class of bug (legacy #37)
      includeAssets: ['icon-192.png', 'icon-512.png', 'favicon.svg'],
      manifest: {
        name: 'KCCP 출석',
        short_name: 'KCCP 출석',
        start_url: '/',
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
