import { defineConfig } from '@playwright/test'

const PORT = 5211

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    headless: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npm run dev', url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
})
