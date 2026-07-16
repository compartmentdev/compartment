const defaultConsoleE2eBaseUrl: string = 'http://console.localhost:9080';

export interface ConsoleE2eProxySettings {
  readonly server: string;
}

export function readConsoleE2eBaseUrl(): string {
  const baseUrl: string =
    readEnvironmentValue('PLAYWRIGHT_BASE_URL') ??
    readEnvironmentValue('COMPARTMENT_E2E_BASE_URL') ??
    defaultConsoleE2eBaseUrl;

  parseConsoleE2eBaseUrl(baseUrl);
  return baseUrl;
}

export function readEnvironmentValue(name: string): string | undefined {
  const value: string | undefined = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function readRequiredEnvironmentValue(name: string): string {
  const value: string | undefined = readEnvironmentValue(name);
  if (value === undefined) {
    throw new Error(`${name} is required for console e2e. CI setup must create the test account and export it.`);
  }

  return value;
}

export function readConsoleE2eProxySettings(): ConsoleE2eProxySettings | undefined {
  const server: string | undefined = readEnvironmentValue('COMPARTMENT_E2E_HTTP_PROXY');
  return server === undefined ? undefined : { server };
}

function parseConsoleE2eBaseUrl(baseUrl: string): URL {
  try {
    return new URL(baseUrl);
  } catch {
    throw new Error(`Invalid console e2e base URL: ${baseUrl}`);
  }
}
