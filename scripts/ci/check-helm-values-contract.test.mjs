import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import {
  findValuesContractViolations,
  listSchemaValuePaths,
  readChartDependencyValuePaths,
  readChartValueReads,
  readInstallStateFieldPaths,
  readSourceValuePaths,
} from './check-helm-values-contract.mjs';

const chartRoot = join(readRepositoryRoot(import.meta.url, 2), 'deploy/chart/compartment');

describe('readChartDependencyValuePaths', () => {
  it('treats dependency names as chart-owned values roots', () => {
    expect(
      readChartDependencyValuePaths(`
dependencies:
  - name: capsule
    repository: https://projectcapsule.github.io/charts
    version: 0.13.11
  - name: shared-chart
    alias: tenant-addon
    repository: https://charts.example.com
    version: 1.0.0
      `),
    ).toEqual(['capsule', 'tenant-addon']);
  });
});

describe('readSourceValuePaths', () => {
  it('reads direct and aliased chart value paths', () => {
    expect(
      readSourceValuePaths(`
        {{ .Values.platform.logLevel }}
        {{ toYaml .root.Values.resources.wait }}
        {{ dig "storage" "backend" "pvc" .Values.registry }}
        {{ $installState.effective.platform.baseDomain }}
        {{ $persisted.registryIssuerRef.name }}
        {{ $effective.ingressEndpoint.type }}
      `).toSorted(),
    ).toEqual([
      'ingress.endpoint.type',
      'platform.baseDomain',
      'platform.logLevel',
      'registry',
      'registry.issuerRef.name',
      'registry.storage.backend',
      'resources.wait',
    ]);
  });

  it('rejects an install state section without a values path', () => {
    expect(() => readSourceValuePaths('{{ $installState.effective.renamedSection.value }}')).toThrow(
      'Install state section "renamedSection" has no values path',
    );
  });
});

describe('readInstallStateFieldPaths', () => {
  it('maps persisted install state fields onto values paths', () => {
    expect(
      readInstallStateFieldPaths(`
{{- define "compartment.installStateFields" -}}
- secretKey: installation-id
  valuesSection: platform
  valueKey: installationId
- secretKey: ingress-endpoint-type
  valuesSection: ingressEndpoint
  valueKey: type
{{- end }}
      `),
    ).toEqual(['platform.installationId', 'ingress.endpoint.type']);
  });

  it('rejects helpers without the install state field list', () => {
    expect(() => readInstallStateFieldPaths('{{- define "compartment.name" -}}{{- end }}')).toThrow(
      'no longer defines compartment.installStateFields',
    );
  });
});

describe('listSchemaValuePaths', () => {
  it('declares referenced, conditional, and dictionary paths without array elements', () => {
    const { declaredPaths, freeFormPaths } = listSchemaValuePaths({
      type: 'object',
      properties: {
        pool: { $ref: '#/definitions/pool' },
        platform: { properties: { removed: false, kept: { type: 'string' } } },
      },
      allOf: [{ properties: { platform: { properties: { conditional: { type: 'string' } } } } }],
      definitions: {
        pool: {
          properties: {
            nodeSelector: { type: 'object', additionalProperties: { type: 'string' } },
            tolerations: { type: 'array', items: { properties: { key: { type: 'string' } } } },
          },
        },
      },
    });

    expect([...declaredPaths].toSorted()).toEqual([
      'platform',
      'platform.conditional',
      'platform.kept',
      'pool',
      'pool.nodeSelector',
      'pool.tolerations',
    ]);
    expect([...freeFormPaths]).toEqual(['pool.nodeSelector']);
  });

  it('rejects references outside the definition block', () => {
    expect(() => listSchemaValuePaths({ properties: { pool: { $ref: '#/components/pool' } } })).toThrow(
      'Unsupported schema reference',
    );
  });
});

describe('findValuesContractViolations', () => {
  const schema = {
    type: 'object',
    properties: {
      platform: { properties: { logLevel: { type: 'string' } } },
      resources: { properties: { api: { properties: { limits: { type: 'object' } } } } },
      buildkit: { properties: { dnsPodSelector: { type: 'object', additionalProperties: { type: 'string' } } } },
    },
  };

  it('accepts whole-section reads and free-form dictionary keys', () => {
    expect(
      findValuesContractViolations(
        new Map([
          ['platform.logLevel', new Set(['templates/configmap.yaml'])],
          ['resources.api', new Set(['templates/api.yaml'])],
          ['buildkit.dnsPodSelector.k8s-app', new Set(['templates/buildkit.yaml'])],
        ]),
        schema,
      ),
    ).toEqual([]);
  });

  it('reports a template read the schema does not declare', () => {
    expect(
      findValuesContractViolations(
        new Map([
          ['platform.logLevel', new Set(['templates/configmap.yaml'])],
          ['platform.logLevelTypo', new Set(['templates/configmap.yaml', 'templates/worker.yaml'])],
          ['resources.api', new Set(['templates/api.yaml'])],
          ['buildkit.dnsPodSelector', new Set(['templates/buildkit.yaml'])],
        ]),
        schema,
      ),
    ).toEqual([
      'templates/configmap.yaml, templates/worker.yaml: reads .Values.platform.logLevelTypo, which deploy/chart/compartment/values.schema.json does not declare',
    ]);
  });

  it('reports a schema declaration no chart source reads', () => {
    expect(
      findValuesContractViolations(
        new Map([
          ['platform.logLevel', new Set(['templates/configmap.yaml'])],
          ['buildkit.dnsPodSelector', new Set(['templates/buildkit.yaml'])],
        ]),
        schema,
      ),
    ).toEqual([
      'deploy/chart/compartment/values.schema.json: declares resources, which no chart template or file reads',
      'deploy/chart/compartment/values.schema.json: declares resources.api, which no chart template or file reads',
      'deploy/chart/compartment/values.schema.json: declares resources.api.limits, which no chart template or file reads',
    ]);
  });
});

describe('readChartValueReads', () => {
  it('resolves the chart constructs a plain .Values scan cannot follow', () => {
    const reads = readChartValueReads(chartRoot);

    expect(reads.get('registry.storage.backend')).toContain('deploy/chart/compartment/templates/_helpers.tpl');
    expect(reads.get('platform.installationId')).toContain('deploy/chart/compartment/templates/_helpers.tpl');
    expect(reads.get('ingress.endpoint.type')).toContain('deploy/chart/compartment/templates/_helpers.tpl');
    expect(reads.get('projectProvisioner.replicas')).toContain('deploy/chart/compartment/templates/pdb.yaml');
  });
});

describe('the committed chart', () => {
  it('declares every value it reads and reads every value it declares', () => {
    const schema = JSON.parse(readFileSync(join(chartRoot, 'values.schema.json'), 'utf8'));

    expect(findValuesContractViolations(readChartValueReads(chartRoot), schema)).toEqual([]);
  });
});
