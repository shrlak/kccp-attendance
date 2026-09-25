import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // vite.config.ts와 같은 이유 — 설정 탭이 scripts/sheet-sync/Export.gs를 ?raw로 들여온다.
  server: { fs: { allow: ['.', '../scripts/sheet-sync'] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
