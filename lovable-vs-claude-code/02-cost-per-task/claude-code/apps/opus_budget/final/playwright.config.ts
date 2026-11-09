import { defineConfig } from '@playwright/test'

const PORT = 5214

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://localhost:${PORT}`, channel: 'chrome', headless: true },
  webServer: { command: 'npm run dev', url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
})
