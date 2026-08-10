import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  kubernetesSystemStatusResponseSchema,
  kubernetesSystemUpdateResponseSchema,
  whoamiCommandResponseSchema,
  type KubernetesSystemStatusResponse,
  type KubernetesSystemUpdateResponse,
  type WhoAmICommandResponse,
} from '@compartment/contracts';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import { immutableKubeName } from '@compartment/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { buildSelfHostedUserSetupClientEnv } from './self-hosted-user-setup-client-env.harness';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  assertBuiltCliAvailable,
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

interface HelmReleaseOutput {
  readonly revision?: string | undefined;
  readonly status?: string | undefined;
}

interface HelmImageValues {
  readonly images?: Record<string, PlatformImageValue> | undefined;
}

interface PlatformImageValue {
  readonly digest?: string | undefined;
  readonly repository?: string | undefined;
  readonly tag?: string | undefined;
}

interface ChartResourceLimits {
  memory: string;
}

interface ChartResourceEntry {
  limits: ChartResourceLimits;
}

interface ChartValues {
  resources: Record<string, ChartResourceEntry>;
}

interface ReleaseConfigValues {
  images?: Record<string, PlatformImageValue> | undefined;
}

const platformModeEnvName: string = 'COMPARTMENT_E2E_PLATFORM_MODE';
const platformApiUrl: string = process.env.COMPARTMENT_E2E_API_URL ?? 'http://console.compartment.localhost:18680';
const platformKubeContext: string = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e-system-update';
const platformNamespace: string = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment-system-update';
const repositoryRoot: string = resolve(process.cwd(), '../..');
const updateValuesPath: string = resolve(
  repositoryRoot,
  process.env.COMPARTMENT_E2E_UPDATE_VALUES_PATH ?? '.compartment/platform-k3d-system-update/update-values.yaml',
);
const releaseName: string = 'compartment';
const updateVersion: string = 'e2e';
const updateTimeoutMs: number = 20 * 60_000;
const plantTimeoutMs: number = 8 * 60_000;
/** Must exceed the plant plus the update, so the CLI reports its own diagnostics before vitest gives up. */
const testTimeoutMs: number = updateTimeoutMs + plantTimeoutMs + 60_000;
const chartPath: string = resolve(repositoryRoot, 'deploy/chart/compartment');
/**
 * The build memory limits an installation carried before the chart raised them. Planting a release
 * rendered from these makes the upgrade a genuine old-chart-to-new-chart upgrade, which is the only
 * shape that can catch a changed chart default being dropped.
 */
const supersededBuildResourceMemory: Readonly<Record<string, string>> = {
  buildRunner: '512Mi',
  buildkit: '1536Mi',
};
const tempRootDirectory: string = readSocketSafeTempRootDirectory('pk3u-', 'system-api.sock');
const createdDirectories: string[] = [];
const legacyProjectId: string = 'prj_system_update_v1';
const legacyProjectNamespace: string = immutableKubeName('cpt', legacyProjectId);

describe.sequential('production Kubernetes system update', (): void => {
  if (process.env[platformModeEnvName] !== 'k3d') {
    it(`requires ${platformModeEnvName}=k3d`, (): void => {
      expect(process.env[platformModeEnvName]).toBe('k3d');
    });
    return;
  }

  let cli: SelfHostedUserSetupCli;

  beforeAll(async (): Promise<void> => {
    await assertBuiltCliAvailable();
    const homeDirectory: string = await mkdtemp(join(tempRootDirectory, 'client-'));
    createdDirectories.push(homeDirectory);
    cli = new SelfHostedUserSetupCli(buildSelfHostedUserSetupClientEnv(homeDirectory), updateTimeoutMs);
  });

  afterAll(async (): Promise<void> => {
    await Promise.all(
      createdDirectories
        .splice(0)
        .map(async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true })),
    );
  });

  it(
    'adopts changed chart defaults, updates verified platform images, completes the revision migration, and preserves owner data',
    async (): Promise<void> => {
      const chartBuildResourceMemory: Readonly<Record<string, string>> = await readChartBuildResourceMemory();
      await plantSupersededChartDefaults();
      const plantedOperatorValues: ReleaseConfigValues = await readOperatorValuesExceptImages();
      const previousRevision: number = await readHelmRevision();
      const previousApiImage: string = await readApiImage();
      const restoreControllersAfterUpdateFailure: () => Promise<void> = await prepareLegacyQuotaFixture();
      let update: KubernetesSystemUpdateResponse;
      try {
        update = await cli.runJson(
          `system update --values ${updateValuesPath} --version ${updateVersion} --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name ${releaseName}`,
          kubernetesSystemUpdateResponseSchema,
        );
      } catch (error) {
        await restoreControllersAfterUpdateFailure();
        throw error;
      }

      expect(update.updated).toBe(true);
      expect(update.version).toBe(updateVersion);
      expect(await readReleasedBuildResourceMemory()).toEqual(chartBuildResourceMemory);
      expect(await readOperatorValuesExceptImages()).toEqual(plantedOperatorValues);
      const updatedRevision: number = await readHelmRevision();
      expect(updatedRevision).toBe(previousRevision + 1);
      await expectMigrationCompleted(updatedRevision);
      await expectUpdatedImageVersions();
      const updatedApiImage: string = await readApiImage();
      expect(updatedApiImage).not.toBe(previousApiImage);
      expect(updatedApiImage).toBe(await readTargetApiImage());
      await expectQuotaBackfillCompleted();

      const ownerEmail: string = requireEnvironment('COMPARTMENT_E2E_SEED_ADMIN_EMAIL');
      const ownerPassword: string = requireEnvironment('COMPARTMENT_E2E_SEED_ADMIN_PASSWORD');
      await cli.runBrowserLogin(
        `login --api-url ${platformApiUrl} --email ${ownerEmail} --output json`,
        {
          email: ownerEmail,
          password: ownerPassword,
        },
        { requestOrigin: platformApiUrl },
      );
      const identity: WhoAmICommandResponse = await cli.runJson('whoami', whoamiCommandResponseSchema);
      expect(identity.principal.email).toBe(ownerEmail);
      const status: KubernetesSystemStatusResponse = await cli.runJson(
        `system status --kube-context ${platformKubeContext} --namespace ${platformNamespace} --release-name ${releaseName}`,
        kubernetesSystemStatusResponseSchema,
      );
      expect(status.ready).toBe(true);
    },
    testTimeoutMs,
  );
});

async function readChartBuildResourceMemory(): Promise<Readonly<Record<string, string>>> {
  const values: ChartValues = parse(await readFile(join(chartPath, 'values.yaml'), 'utf8')) as ChartValues;
  const memory: Record<string, string> = {};
  for (const name of Object.keys(supersededBuildResourceMemory)) {
    const declared: string | undefined = values.resources[name]?.limits.memory;
    expect(declared).toBeTypeOf('string');
    expect(declared).not.toBe(supersededBuildResourceMemory[name]);
    memory[name] = declared!;
  }
  return memory;
}

/**
 * Renders the release from a copy of the chart carrying the superseded build memory defaults, so the
 * release under test holds an older chart's defaults while the chart the update ships declares new
 * ones. That is the state a real installation was in, and the only state in which an update can drop
 * a changed default.
 *
 * The plant itself must use `--reset-then-reuse-values`: `--reuse-values` keeps the values the
 * release was already rendered from and ignores the defaults of the chart it is handed, so planting
 * with it is a no-op that would leave this test asserting nothing. It waits, because the migration
 * Job is a plain resource keyed by release revision and the update prunes the previous one.
 *
 * It passes no `--values`: the update values file carries the images the update itself is supposed to
 * move the release to, and planting those here would defeat the image assertions.
 */
async function plantSupersededChartDefaults(): Promise<void> {
  const directory: string = await mkdtemp(join(tempRootDirectory, 'superseded-chart-'));
  createdDirectories.push(directory);
  const supersededChartPath: string = join(directory, 'compartment');
  await cp(chartPath, supersededChartPath, { recursive: true });
  const valuesPath: string = join(supersededChartPath, 'values.yaml');
  const values: ChartValues = parse(await readFile(valuesPath, 'utf8')) as ChartValues;
  for (const [name, memory] of Object.entries(supersededBuildResourceMemory)) {
    values.resources[name]!.limits.memory = memory;
  }
  await writeFile(valuesPath, stringify(values));
  await runRequired(
    [
      'helm',
      'upgrade',
      releaseName,
      supersededChartPath,
      '--namespace',
      platformNamespace,
      '--kube-context',
      platformKubeContext,
      '--reset-then-reuse-values',
      '--wait',
      '--wait-for-jobs',
      '--timeout',
      '6m',
    ],
    plantTimeoutMs,
  );
  expect(await readReleasedBuildResourceMemory()).toEqual(supersededBuildResourceMemory);
}

async function readReleasedBuildResourceMemory(): Promise<Readonly<Record<string, string>>> {
  const rendered: Record<string, string> = {};
  const configMapKeys: readonly (readonly [string, string])[] = [
    ['buildRunner', 'COMPARTMENT_BUILD_RUNNER_RESOURCES'],
    ['buildkit', 'COMPARTMENT_BUILDKIT_RESOURCES'],
  ];
  for (const [name, key] of configMapKeys) {
    const result: SelfHostedUserSetupCommandResult = await runRequired([
      'kubectl',
      '--context',
      platformKubeContext,
      '--namespace',
      platformNamespace,
      'get',
      `configmap/${releaseName}`,
      `--output=jsonpath={.data.${key}}`,
    ]);
    rendered[name] = (JSON.parse(result.stdout) as ChartResourceEntry).limits.memory;
  }
  return rendered;
}

async function readOperatorValuesExceptImages(): Promise<ReleaseConfigValues> {
  const result: SelfHostedUserSetupCommandResult = await runRequired([
    'helm',
    'get',
    'values',
    releaseName,
    '--namespace',
    platformNamespace,
    '--kube-context',
    platformKubeContext,
    '--output',
    'json',
  ]);
  const values: ReleaseConfigValues = (JSON.parse(result.stdout) ?? {}) as ReleaseConfigValues;
  Reflect.deleteProperty(values, 'images');
  return values;
}

async function readHelmRevision(): Promise<number> {
  const result: SelfHostedUserSetupCommandResult = await runRequired([
    'helm',
    'list',
    '--namespace',
    platformNamespace,
    '--kube-context',
    platformKubeContext,
    '--filter',
    `^${releaseName}$`,
    '--output',
    'json',
  ]);
  const release: HelmReleaseOutput | undefined = (JSON.parse(result.stdout) as HelmReleaseOutput[])[0];
  expect(release?.status).toBe('deployed');
  const revision: number = Number.parseInt(release?.revision ?? '', 10);
  if (!Number.isSafeInteger(revision)) {
    throw new Error('Expected Helm to report a numeric release revision.');
  }
  return revision;
}

async function prepareLegacyQuotaFixture(): Promise<() => Promise<void>> {
  const stoppedComponents: string[] = [];
  try {
    for (const component of ['worker', 'project-provisioner']) {
      await runRequired([
        'kubectl',
        '--context',
        platformKubeContext,
        '--namespace',
        platformNamespace,
        'scale',
        `deployment/${releaseName}-${component}`,
        '--replicas=0',
      ]);
      stoppedComponents.push(component);
      await runRequired([
        'kubectl',
        '--context',
        platformKubeContext,
        '--namespace',
        platformNamespace,
        'wait',
        '--for=delete',
        'pod',
        `--selector=app.kubernetes.io/component=${component}`,
        '--timeout=120s',
      ]);
    }
    const organizationId: string = (
      await runPostgresQuery('select id from organizations order by created_at limit 1')
    ).trim();
    if (organizationId === '') {
      throw new Error('Expected an installed organization for the isolation v1 update fixture.');
    }
    await runPostgresQuery(
      `insert into projects (id, organization_id, name) values ('${legacyProjectId}', '${organizationId}', 'system-update-v1'); ` +
        `insert into project_kube_provisioning (project_id, state, attempts, isolation_version) values ('${legacyProjectId}', 'succeeded', 1, 1); ` +
        `update organization_quota_reconciliation set attempts = 0, failure_message = null, lease_expires_at = null, lease_id = null, state = 'pending' where organization_id = '${organizationId}'`,
    );
    await runRequired(['kubectl', '--context', platformKubeContext, 'create', 'namespace', legacyProjectNamespace]);
    await runRequired([
      'kubectl',
      '--context',
      platformKubeContext,
      'label',
      'namespace',
      legacyProjectNamespace,
      'app.kubernetes.io/managed-by=compartment',
      `compartment.dev/namespace-id=${legacyProjectId}`,
      `compartment.dev/project-id=${legacyProjectId}`,
    ]);
    return async (): Promise<void> => await restoreLegacyControllers(stoppedComponents);
  } catch (error) {
    await restoreLegacyControllers(stoppedComponents);
    throw error;
  }
}

async function restoreLegacyControllers(components: readonly string[]): Promise<void> {
  await Promise.allSettled(
    components.map(
      async (component: string): Promise<SelfHostedUserSetupCommandResult> =>
        await runRequired([
          'kubectl',
          '--context',
          platformKubeContext,
          '--namespace',
          platformNamespace,
          'scale',
          `deployment/${releaseName}-${component}`,
          '--replicas=1',
        ]),
    ),
  );
}

async function expectQuotaBackfillCompleted(): Promise<void> {
  await runRequired([
    'kubectl',
    '--context',
    platformKubeContext,
    '--namespace',
    platformNamespace,
    'rollout',
    'status',
    `deployment/${releaseName}-worker`,
    '--timeout=120s',
  ]);
  let state: string = '';
  let organizationLabel: string = '';
  for (let attempt: number = 0; attempt < 120; attempt += 1) {
    state = (
      await runPostgresQuery(
        `select state || ':' || isolation_version from project_kube_provisioning where project_id = '${legacyProjectId}'`,
      )
    ).trim();
    organizationLabel = (
      await runRequired([
        'kubectl',
        '--context',
        platformKubeContext,
        'get',
        'namespace',
        legacyProjectNamespace,
        '--output=jsonpath={.metadata.labels.compartment\\.dev/organization-id}',
      ])
    ).stdout.trim();
    if (state === 'succeeded:2' && organizationLabel !== '') {
      return;
    }
    await new Promise<void>((resolveDelay: () => void): NodeJS.Timeout => setTimeout(resolveDelay, 1_000));
  }
  const quotaState: string = (
    await runPostgresQuery(
      `select q.state || ':' || q.attempts || ':' || coalesce(q.failure_message, '') from organization_quota_reconciliation q inner join projects p on p.organization_id = q.organization_id where p.id = '${legacyProjectId}'`,
    )
  ).trim();
  throw new Error(
    `System update did not backfill the isolation v1 project namespace and quota infrastructure: state=${state}, organizationLabel=${organizationLabel}, quotaState=${quotaState}.`,
  );
}

async function runPostgresQuery(query: string): Promise<string> {
  return (
    await runRequired([
      'kubectl',
      '--context',
      platformKubeContext,
      '--namespace',
      platformNamespace,
      'exec',
      `deployment/${releaseName}-postgres`,
      '--',
      'psql',
      '--username=postgres',
      '--dbname=compartment',
      '--tuples-only',
      '--no-align',
      '--command',
      query,
    ])
  ).stdout;
}

async function expectMigrationCompleted(revision: number): Promise<void> {
  const jobName: string = `${releaseName}-api-migrate-${revision.toString()}`;
  const result: SelfHostedUserSetupCommandResult = await runRequired([
    'kubectl',
    '--context',
    platformKubeContext,
    '--namespace',
    platformNamespace,
    'get',
    `job/${jobName}`,
    '--output=jsonpath={.status.succeeded}',
  ]);
  expect(result.stdout.trim()).toBe('1');
}

async function expectUpdatedImageVersions(): Promise<void> {
  const result: SelfHostedUserSetupCommandResult = await runRequired([
    'helm',
    'get',
    'values',
    releaseName,
    '--namespace',
    platformNamespace,
    '--kube-context',
    platformKubeContext,
    '--output',
    'json',
  ]);
  const values: HelmImageValues = JSON.parse(result.stdout) as HelmImageValues;
  for (const imageName of ['api', 'caddy', 'dns01Solver', 'edge', 'worker']) {
    expect(values.images?.[imageName]?.tag).toBe(updateVersion);
  }
}

async function readApiImage(): Promise<string> {
  const result: SelfHostedUserSetupCommandResult = await runRequired([
    'kubectl',
    '--context',
    platformKubeContext,
    '--namespace',
    platformNamespace,
    'get',
    `deployment/${releaseName}-api`,
    '--output=jsonpath={.spec.template.spec.containers[0].image}',
  ]);
  return result.stdout.trim();
}

async function readTargetApiImage(): Promise<string> {
  const values: HelmImageValues = parse(await readFile(updateValuesPath, 'utf8')) as HelmImageValues;
  const api: PlatformImageValue | undefined = values.images?.api;
  if (api?.repository === undefined || api.digest === undefined) {
    throw new Error('Expected target API repository and digest values.');
  }
  return `${api.repository}@${api.digest}`;
}

async function runRequired(
  argv: readonly string[],
  timeoutMs: number = 60_000,
): Promise<SelfHostedUserSetupCommandResult> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({ argv, timeoutMs });
  expectSuccessfulCommand(result, argv.join(' '));
  return result;
}

function requireEnvironment(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Expected ${name} for the installed platform owner.`);
  }
  return value;
}
