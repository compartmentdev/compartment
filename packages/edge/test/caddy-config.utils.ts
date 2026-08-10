import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CaddyAdaptedConfig,
  CaddyCommandResult,
  CaddyHandler,
  CaddyHandlerLocation,
  CaddyMatcher,
  CaddyRoute,
  CaddyRouteScope,
  CaddyServerConfig,
  CaddyValidationSetup,
} from './caddy-config.types';

const repositoryRoot: string = resolve(__dirname, '../../..');
const chartCaddyTemplatePath: string = resolve(repositoryRoot, 'deploy/chart/compartment/templates/caddy.yaml');
const caddyValidationImageVariable: string = 'COMPARTMENT_CADDY_VALIDATION_IMAGE';
const caddyValidationRequiredVariable: string = 'COMPARTMENT_CADDY_VALIDATION_REQUIRED';
const adaptedConfigsByCaddyfile = new Map<string, CaddyAdaptedConfig>();

/**
 * The values mirror `deploy/chart/compartment/values.yaml` defaults as the chart passes them to the
 * Caddy container in `templates/caddy.yaml`. Adapting under a different environment would prove a
 * configuration nobody runs.
 */
export const chartCaddyEnvironment: Readonly<Record<string, string>> = Object.freeze({
  COMPARTMENT_API_INTERNAL_HOST: 'compartment-api',
  COMPARTMENT_API_PORT: '39444',
  COMPARTMENT_BASE_DOMAIN: 'localhost',
  COMPARTMENT_CADDY_HTTP_PORT: '8080',
  COMPARTMENT_EDGE_APP_BURST: '600',
  COMPARTMENT_EDGE_APP_IN_FLIGHT: '512',
  COMPARTMENT_EDGE_APP_REQUESTS_PER_SECOND: '300',
  COMPARTMENT_EDGE_CLIENT_BURST: '120',
  COMPARTMENT_EDGE_CLIENT_REQUESTS_PER_SECOND: '60',
  COMPARTMENT_EDGE_INTERNAL_HOST: 'compartment-edge',
  COMPARTMENT_EDGE_PORT: '39081',
  COMPARTMENT_EDGE_TOKEN: 'caddy-config-validation-edge-token',
  COMPARTMENT_USAGE_METERING_INTERVAL_MS: '60000',
});

/**
 * A missing Caddy build makes the adapted-config suite skip, which is only acceptable on a
 * developer machine. CI sets the required flag so the same gap fails the run instead.
 */
export function readCaddyValidationSetup(): CaddyValidationSetup {
  const image: string | undefined = process.env[caddyValidationImageVariable];
  const required: boolean = process.env[caddyValidationRequiredVariable] === '1';
  const resolvedImage: string | undefined = image === undefined || image === '' ? undefined : image;

  if (required && resolvedImage === undefined) {
    throw new Error(
      `${caddyValidationRequiredVariable}=1 requires ${caddyValidationImageVariable} to point at a Caddy image built ` +
        'from packages/edge/Dockerfile.caddy.self-hosted. Caddyfile validation must never skip in CI.',
    );
  }

  return { image: resolvedImage, required };
}

export function validateCaddyfile(caddyfile: string): CaddyCommandResult {
  return runCaddy(['validate', '--config', '-', '--adapter', 'caddyfile'], caddyfile);
}

export function adaptCaddyfile(caddyfile: string): CaddyAdaptedConfig {
  const cachedConfig: CaddyAdaptedConfig | undefined = adaptedConfigsByCaddyfile.get(caddyfile);
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const result: CaddyCommandResult = runCaddy(['adapt', '--config', '-', '--adapter', 'caddyfile'], caddyfile);
  if (result.exitCode !== 0) {
    throw new Error(`caddy adapt failed with exit code ${result.exitCode}: ${result.stderr}`);
  }

  const adaptedConfig: CaddyAdaptedConfig = JSON.parse(result.stdout) as CaddyAdaptedConfig;
  adaptedConfigsByCaddyfile.set(caddyfile, adaptedConfig);
  return adaptedConfig;
}

export function readSingleCaddyServer(config: CaddyAdaptedConfig): CaddyServerConfig {
  const servers: CaddyServerConfig[] = Object.values(config.apps.http.servers);
  const [server]: CaddyServerConfig[] = servers;
  if (servers.length !== 1 || server === undefined) {
    throw new Error(`Expected exactly one adapted HTTP server, found ${servers.length}.`);
  }

  return server;
}

export function collectCaddyHandlers(server: CaddyServerConfig): CaddyHandlerLocation[] {
  const locations: CaddyHandlerLocation[] = [];
  collectRouteHandlers(server.routes, { hosts: [], matchers: [] }, locations);
  return locations;
}

/**
 * `headers` handlers keep their operations at the top level while `reverse_proxy` nests them, so
 * reading deletions has to accept both shapes.
 */
export function readDeletedRequestHeaders(handler: CaddyHandler): string[] {
  return [...(handler.request?.delete ?? []), ...(handler.headers?.request?.delete ?? [])];
}

export function readCaddyfileEnvironmentPlaceholders(caddyfile: string): string[] {
  const placeholderPattern = /\{\$([A-Z0-9_]+)(?<fallback>:[^}]*)?\}/gu;
  const names = new Set<string>();

  for (const match of caddyfile.matchAll(placeholderPattern)) {
    const [, name] = match;
    // Placeholders that carry their own fallback keep working when the chart omits them.
    if (name !== undefined && match.groups?.fallback === undefined) {
      names.add(name);
    }
  }

  return [...names].sort(compareNames);
}

export function readChartCaddyEnvironmentNames(): string[] {
  const template: string = readFileSync(chartCaddyTemplatePath, 'utf8');
  const environmentNamePattern = /name: (COMPARTMENT_[A-Z0-9_]+)/gu;

  return [...new Set([...template.matchAll(environmentNamePattern)].map(([, name]: string[]): string => name ?? ''))]
    .filter((name: string): boolean => name !== '')
    .sort(compareNames);
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right);
}

function runCaddy(args: readonly string[], caddyfile: string): CaddyCommandResult {
  const setup: CaddyValidationSetup = readCaddyValidationSetup();
  if (setup.image === undefined) {
    throw new Error(`${caddyValidationImageVariable} is not set, so no Caddy build is available to run ${args[0]}.`);
  }

  const environmentArgs: string[] = Object.entries(chartCaddyEnvironment).flatMap(
    ([name, value]: [string, string]): string[] => ['--env', `${name}=${value}`],
  );
  // The adapter never needs egress, and denying it keeps a config gate from depending on the network.
  const result: SpawnSyncReturns<string> = spawnSync(
    'docker',
    ['run', '--rm', '--interactive', '--network', 'none', ...environmentArgs, setup.image, ...args],
    { encoding: 'utf8', input: caddyfile, maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  return { exitCode: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
}

function collectRouteHandlers(
  routes: readonly CaddyRoute[],
  inherited: CaddyRouteScope,
  locations: CaddyHandlerLocation[],
): void {
  for (const route of routes) {
    const routeMatchers: CaddyMatcher[] = route.match ?? [];
    const scope: CaddyRouteScope = {
      hosts: [...inherited.hosts, ...routeMatchers.flatMap((matcher: CaddyMatcher): string[] => matcher.host ?? [])],
      matchers: [...inherited.matchers, ...routeMatchers],
    };

    for (const handler of route.handle ?? []) {
      locations.push({ handler, hosts: scope.hosts, matchers: scope.matchers, order: locations.length });
      collectNestedHandlers(handler, scope, locations);
    }
  }
}

function collectNestedHandlers(handler: CaddyHandler, scope: CaddyRouteScope, locations: CaddyHandlerLocation[]): void {
  collectRouteHandlers(handler.routes ?? [], scope, locations);

  for (const responseHandler of handler.handle_response ?? []) {
    collectRouteHandlers(responseHandler.routes ?? [], scope, locations);
  }
}
