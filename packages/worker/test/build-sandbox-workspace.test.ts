import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { KubeJobEmptyDirVolume } from '@compartment/kube-runtime';
import { assertBuildSandboxMemoryBudget, buildSandboxVolumes } from '../src/services/build-sandbox-workspace';
import type { WorkerBuildSandboxConfig } from '../src/config.types';

interface ChartBuildValues {
  buildkit: { gcKeepStorageMb: number };
  resources: { buildRunner: ChartContainerResources; buildkit: ChartContainerResources };
}

interface ChartContainerResources {
  limits: { memory: string };
}

const chartDirectory: string = resolve(__dirname, '../../../deploy/chart/compartment');
const admissionPolicyPath: string = resolve(chartDirectory, 'templates/buildkit.yaml');
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
          gcKeepStorageMb: values.buildkit.gcKeepStorageMb,
          runnerMemory: values.resources.buildRunner.limits.memory,
        }),
      ),
    ).not.toThrow();
  });

  it('declares exactly the volume set the admission policy admits', async (): Promise<void> => {
    const policy: string = await readFile(admissionPolicyPath, 'utf8');
    const volumes: KubeJobEmptyDirVolume[] = buildSandboxVolumes();

    for (const volume of volumes) {
      expect(policy).toContain(
        `object.spec.template.spec.volumes.exists(volume, volume.name == '${volume.name}' && ` +
          `quantity(volume.emptyDir.sizeLimit).compareTo(quantity('${String(volume.sizeLimit)}')) == 0)`,
      );
    }
    expect(policy).toContain(`object.spec.template.spec.volumes.size() == ${String(volumes.length)}`);
    expect(policy.match(/quantity\(volume\.emptyDir\.sizeLimit\)/gu)).toHaveLength(volumes.length);
  });
});

function buildSandboxConfig(overrides: {
  buildKitMemory?: string;
  gcKeepStorageMb?: number;
  runnerMemory?: string;
}): WorkerBuildSandboxConfig {
  return {
    buildKitResources: { limits: { memory: overrides.buildKitMemory ?? '3Gi' } },
    gcKeepStorageMb: overrides.gcKeepStorageMb ?? 1024,
    namespace: 'compartment-build',
    runnerResources: { limits: { memory: overrides.runnerMemory ?? '1Gi' } },
    scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
    timeoutMs: 1_800_000,
  };
}
