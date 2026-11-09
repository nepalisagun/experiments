import { defineConfig } from '@playwright/test'

const PORT = 5210

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://localhost:${PORT}`, channel: 'chrome', headless: true },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: { command: 'npm run dev', url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
})
