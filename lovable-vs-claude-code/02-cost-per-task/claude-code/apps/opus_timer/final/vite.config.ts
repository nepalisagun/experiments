/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5210, strictPort: true },
  // A fixed zone with a DST change on 1 Nov 2026, so day-boundary tests are meaningful everywhere.
  test: { include: ['src/**/*.test.ts'], env: { TZ: 'America/New_York' } },
})
