/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: the UI runs on :5173 and talks to a local rgcs-server on :8000.
const SERVER = process.env.RGCS_SERVER ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**'], exclude: ['src/shared/api/generated/**', 'src/test/**', 'src/main.tsx'] },
  },
})
