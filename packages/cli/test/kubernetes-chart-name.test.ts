import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCompartmentChartFullname } from '../src/services/kubernetes-chart-name';

describe('Compartment chart resource naming', (): void => {
  it.each<[string, string, string]>([
    ['compartment', '{}', 'compartment'],
    ['public-operator', '{}', 'public-operator-compartment'],
    ['compartment-prod', '{}', 'compartment-prod'],
    ['compartment', 'fullnameOverride: platform\n', 'platform'],
    ['release', 'nameOverride: platform\n', 'release-platform'],
    ['public-operator', "nameOverride: ''\n", 'public-operator-compartment'],
    [
      'release-name-that-is-longer-than-the-kubernetes-resource-name-limit-by-far',
      '{}',
      'release-name-that-is-longer-than-the-kubernetes-resource-name-l',
    ],
  ])(
    'resolves release %s from operator values to fullname %s',
    async (releaseName: string, values: string, expectedFullname: string): Promise<void> => {
      const directory: string = await mkdtemp(join(tmpdir(), 'compartment-chart-name-'));
      const valuesPath: string = join(directory, 'values.yaml');
      try {
        await writeFile(valuesPath, values);
        await expect(readCompartmentChartFullname(releaseName, valuesPath)).resolves.toBe(expectedFullname);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});
