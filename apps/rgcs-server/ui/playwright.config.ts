import { defineConfig, devices } from '@playwright/test'

// The server under test is started by scripts/e2e.sh (built UI served by rgcs-server).
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8010'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
