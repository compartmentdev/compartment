import { defineConfig, devices, type PlaywrightTestConfig, type Project } from '@playwright/test';
import { readConsoleE2eBaseUrl } from './support/console-e2e-runtime';

const isCi: boolean = process.env.CI === 'true';
const consoleBaseUrl: string = readConsoleE2eBaseUrl();

const chromiumProject: Project = {
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
};

const config: PlaywrightTestConfig = defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: isCi,
  fullyParallel: false,
  outputDir: '../../dist-test/playwright-results',
  projects: [chromiumProject],
  reporter: isCi ? [['list'], ['github']] : [['list']],
  retries: isCi ? 1 : 0,
  testDir: './specs',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  tsconfig: '../../tsconfig.test.json',
  use: {
    actionTimeout: 10_000,
    baseURL: consoleBaseUrl,
    ignoreHTTPSErrors: true,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: isCi ? 'on-first-retry' : 'retain-on-failure',
    video: 'off',
  },
  workers: 1,
});

export default config;
