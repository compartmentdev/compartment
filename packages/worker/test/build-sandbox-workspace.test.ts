import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { assertBuildSandboxMemoryBudget } from '../src/services/build-sandbox-workspace';
import type { WorkerBuildSandboxConfig } from '../src/config.types';

interface ChartBuildValues {
  buildkit: { dataSizeLimit: string; gcKeepStorageMb: number };
  resources: { buildRunner: ChartContainerResources; buildkit: ChartContainerResources };
}

interface ChartContainerResources {
  limits: { memory: string };
}

const chartDirectory: string = resolve(__dirname, '../../../deploy/chart/compartment');
const valuesPath: string = resolve(chartDirectory, 'values.yaml');

describe('build sandbox workspace', (): void => {
  it('refuses a build Pod memory limit that cannot hold the gVisor tmpfs workspace', (): void => {
    expect((): void =>
      assertBuildSandboxMemoryBudget(buildSandboxConfig({ buildKitMemory: '1536Mi', runnerMemory: '512Mi' })),
    ).toThrow('The build Pod memory limit of 2048Mi does not cover the 3072Mi gVisor tmpfs build workspace');
  });

  it('refuses BuildKit cache retention that outgrows the memory-backed data volume', (): void => {
    expect((): void => assertBuildSandboxMemoryBudget(buildSandboxConfig({ gcKeepStorageMb: 4096 }))).toThrow(
      'buildkit.gcKeepStorageMb reserves 3906Mi of BuildKit cache inside the 2048Mi memory-backed build data volume',
    );
  });

  it('funds the declared workspace with the memory limits the chart installs', async (): Promise<void> => {
    const values: ChartBuildValues = parse(await readFile(valuesPath, 'utf8')) as ChartBuildValues;

    expect((): void =>
      assertBuildSandboxMemoryBudget(
        buildSandboxConfig({
          buildKitMemory: values.resources.buildkit.limits.memory,
          dataSizeLimit: values.buildkit.dataSizeLimit,
          gcKeepStorageMb: values.buildkit.gcKeepStorageMb,
          runnerMemory: values.resources.buildRunner.limits.memory,
        }),
      ),
    ).not.toThrow();
  });
});

function buildSandboxConfig(overrides: {
  buildKitMemory?: string;
  dataSizeLimit?: string;
  gcKeepStorageMb?: number;
  runnerMemory?: string;
}): WorkerBuildSandboxConfig {
  return {
    buildKitConfigMapName: 'compartment-buildkit',
    dataSizeLimit: overrides.dataSizeLimit ?? '2Gi',
    buildKitResources: { limits: { memory: overrides.buildKitMemory ?? '3Gi' } },
    gcKeepStorageMb: overrides.gcKeepStorageMb ?? 1024,
    namespace: 'compartment-build',
    runnerResources: { limits: { memory: overrides.runnerMemory ?? '1Gi' } },
    scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
    timeoutMs: 1_800_000,
  };
}
