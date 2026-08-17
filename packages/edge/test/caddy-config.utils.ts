import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAllDocuments, parseDocument } from 'yaml';
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
  ChartContainer,
  ChartContainerEnvEntry,
  ChartManifest,
  WorkflowFile,
  WorkflowJob,
} from './caddy-config.types';

const repositoryRoot: string = resolve(__dirname, '../../..');
const chartPath: string = resolve(repositoryRoot, 'deploy/chart/compartment');
const caddyValidationImageVariable: string = 'COMPARTMENT_CADDY_VALIDATION_IMAGE';
const caddyValidationRequiredVariable: string = 'COMPARTMENT_CADDY_VALIDATION_REQUIRED';
const caddyContainerName: string = 'caddy';
/** Secret-backed values are not part of a rendered chart, but the adapter still needs something to substitute. */
const renderedSecretPlaceholder: string = 'caddy-config-validation-secret';
const adaptedConfigsByCaddyfile = new Map<string, CaddyAdaptedConfig>();
let chartCaddyEnvironmentCache: Readonly<Record<string, string>> | undefined;

/**
 * A missing Caddy build or Helm binary makes the adapted-config suite skip, which is only acceptable
 * on a developer machine. CI sets the required flag so the same gap fails the run instead.
 */
export function readCaddyValidationSetup(): CaddyValidationSetup {
  const image: string | undefined = process.env[caddyValidationImageVariable];
  const required: boolean = process.env[caddyValidationRequiredVariable] === '1';
  const resolvedImage: string | undefined = image === undefined || image === '' ? undefined : image;
  const helmAvailable: boolean = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;

  if (required && resolvedImage === undefined) {
    throw new Error(
      `${caddyValidationRequiredVariable}=1 requires ${caddyValidationImageVariable} to point at a Caddy image built ` +
        'from packages/edge/Dockerfile.caddy.self-hosted. Caddyfile validation must never skip in CI.',
    );
  }
  if (required && !helmAvailable) {
    throw new Error(
      `${caddyValidationRequiredVariable}=1 requires a helm binary on PATH: the validation environment is rendered ` +
        'from the chart instead of copied. Caddyfile validation must never skip in CI.',
    );
  }

  return { helmAvailable, image: resolvedImage, required };
}

/**
 * The environment comes from the rendered chart rather than a copy of its values, so a changed
 * default or a changed template expression validates a configuration the container never receives.
 */
export function readChartCaddyEnvironment(): Readonly<Record<string, string>> {
  chartCaddyEnvironmentCache ??= Object.freeze(readRenderedCaddyContainerEnvironment());
  return chartCaddyEnvironmentCache;
}

export function readWorkflowJob(workflowPath: string, jobName: string): WorkflowJob {
  const workflow: WorkflowFile = parseDocument(readFileSync(workflowPath, 'utf8')).toJS() as WorkflowFile;
  const job: WorkflowJob | undefined = workflow.jobs[jobName];
  if (job === undefined) {
    throw new Error(`Workflow ${workflowPath} has no ${jobName} job.`);
  }

  return job;
}

export function readWorkflowJobNames(workflowPath: string): string[] {
  const workflow: WorkflowFile = parseDocument(readFileSync(workflowPath, 'utf8')).toJS() as WorkflowFile;
  return Object.keys(workflow.jobs);
}

export function readChartCaddyEnvironmentValue(name: string): string {
  const value: string | undefined = readChartCaddyEnvironment()[name];
  if (value === undefined) {
    throw new Error(`The rendered chart gives the Caddy container no ${name}.`);
  }

  return value;
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

function compareNames(left: string, right: string): number {
  return left.localeCompare(right);
}

/**
 * The Caddy workload only renders in the full startup stage, and the chart refuses to render at all
 * without an installation identity and a registry issuer, so the gate supplies exactly those.
 */
function readRenderedCaddyContainerEnvironment(): Record<string, string> {
  const result: SpawnSyncReturns<string> = spawnSync(
    'helm',
    [
      'template',
      'compartment',
      chartPath,
      '--show-only',
      'templates/caddy.yaml',
      '--set',
      'platform.startupStage=full',
      '--set',
      'platform.installationId=caddy-config-validation',
      '--set',
      'registry.hostname=10.43.0.1',
      '--set',
      'registry.issuerRef.kind=Issuer',
      '--set',
      'registry.issuerRef.name=compartment',
      '--set',
      `secrets.productLogIngestToken=${renderedSecretPlaceholder}`,
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`helm template failed with exit code ${result.status ?? 1}: ${result.stderr}`);
  }

  return readContainerEnvironment(readRenderedCaddyContainer(result.stdout));
}

function readRenderedCaddyContainer(renderedChart: string): ChartContainer {
  const manifests: ChartManifest[] = parseAllDocuments(renderedChart).map(
    (document): ChartManifest => document.toJS() as ChartManifest,
  );
  const containers: ChartContainer[] = manifests.flatMap(
    (manifest: ChartManifest): ChartContainer[] => manifest.spec?.template?.spec?.containers ?? [],
  );
  const container: ChartContainer | undefined = containers.find(
    (candidate: ChartContainer): boolean => candidate.name === caddyContainerName,
  );
  if (container === undefined) {
    throw new Error('The rendered chart has no Caddy container to take the validation environment from.');
  }

  return container;
}

function readContainerEnvironment(container: ChartContainer): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const entry of container.env ?? []) {
    environment[entry.name] = readContainerEnvironmentValue(entry);
  }

  return environment;
}

/**
 * Substituting a placeholder for an unrecognized source would validate a value the container never
 * sees, so anything beyond a literal or a secret reference has to stop the gate.
 */
function readContainerEnvironmentValue(entry: ChartContainerEnvEntry): string {
  if (entry.value !== undefined) {
    return entry.value;
  }
  if (entry.valueFrom?.secretKeyRef !== undefined) {
    return renderedSecretPlaceholder;
  }

  throw new Error(
    `The rendered chart sets ${entry.name} from ${readEnvironmentSourceKind(entry)}, which the Caddy config gate ` +
      'cannot substitute. Teach it that source before the chart relies on it.',
  );
}

function readEnvironmentSourceKind(entry: ChartContainerEnvEntry): string {
  if (entry.valueFrom === undefined) {
    return 'neither a value nor a valueFrom';
  }

  const sourceKinds: string[] = Object.keys(entry.valueFrom);
  return sourceKinds.length === 0 ? 'an empty valueFrom' : sourceKinds.join(', ');
}

function runCaddy(args: readonly string[], caddyfile: string): CaddyCommandResult {
  const setup: CaddyValidationSetup = readCaddyValidationSetup();
  if (setup.image === undefined) {
    throw new Error(`${caddyValidationImageVariable} is not set, so no Caddy build is available to run ${args[0]}.`);
  }

  const environmentArgs: string[] = Object.entries(readChartCaddyEnvironment()).flatMap(
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
