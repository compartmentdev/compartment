import { defineConfig, devices, type PlaywrightTestConfig, type Project } from '@playwright/test';
import {
  readConsoleE2eBaseUrl,
  readConsoleE2eProxySettings,
  type ConsoleE2eProxySettings,
} from './support/console-e2e-runtime';

const isCi: boolean = process.env.CI === 'true';
const consoleBaseUrl: string = readConsoleE2eBaseUrl();
const consoleE2eProxySettings: ConsoleE2eProxySettings | undefined = readConsoleE2eProxySettings();
/**
 * The pull-request lane proves the flows that only a live platform can prove; @full marks the
 * variants that harden an already-covered boundary and run in the full matrix. An unset scope runs
 * everything, and an unrecognised one fails rather than silently choosing a lane.
 */
const runsFullScope: boolean = readConsoleE2eRunsFullScope();

function readConsoleE2eRunsFullScope(): boolean {
  const scope: string = process.env.COMPARTMENT_E2E_SCOPE ?? 'full';
  if (scope !== 'pr' && scope !== 'full') {
    throw new Error(`COMPARTMENT_E2E_SCOPE must be pr or full, received ${scope}.`);
  }

  return scope === 'full';
}

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
  ...(runsFullScope ? {} : { grepInvert: /@full/u }),
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
    ...(consoleE2eProxySettings === undefined ? {} : { proxy: consoleE2eProxySettings }),
    screenshot: 'only-on-failure',
    trace: isCi ? 'on-first-retry' : 'retain-on-failure',
    video: 'off',
  },
  workers: 1,
});

export default config;
