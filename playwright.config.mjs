import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3012',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3012',
    url: 'http://127.0.0.1:3012',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://sid-test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
      SUPABASE_SECRET_KEY: 'test-server-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
      GEMINI_API_KEY: 'test-gemini-key',
      GOOGLE_TTS_API_KEY: 'test-tts-key',
    },
  },
});
