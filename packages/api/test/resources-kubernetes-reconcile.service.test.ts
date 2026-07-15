import type { ResourceReconcileIntent } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import type { EffectiveVariable } from '../src/services/effective-variables.service.types';
import { bootstrapKubernetesResource } from '../src/services/resources-kubernetes-reconcile.service';
import type { ResourceEnvironmentContext } from '../src/services/resources.service.types';

type LoadVariables = (
  environmentId: string,
  organizationId: string,
  resourceName: string,
) => Promise<EffectiveVariable[]>;
type RequestBootstrap = (operationId: string, intent: ResourceReconcileIntent) => Promise<void>;

const loadVariables: Mock<LoadVariables> = vi.hoisted((): Mock<LoadVariables> => vi.fn());
const requestBootstrap: Mock<RequestBootstrap> = vi.hoisted((): Mock<RequestBootstrap> => vi.fn());

vi.mock('../src/services/resources-effective-variables.service', (): object => ({
  loadResourceEffectiveVariables: loadVariables,
}));
vi.mock('../src/services/resource-reconcile-run.service', (): object => ({
  requestResourceBootstrap: requestBootstrap,
}));

describe('Kubernetes resource reconcile boundary', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    requestBootstrap.mockResolvedValue();
  });

  it('projects current effective variables into the explicit bootstrap Secret intent', async (): Promise<void> => {
    loadVariables.mockResolvedValue([effectiveVariable('POSTGRES_PASSWORD', 'generated-secret')]);

    await bootstrapKubernetesResource(context(), resource());

    expect(loadVariables).toHaveBeenCalledWith('env_prod', 'org', 'postgres');
    expect(requestBootstrap.mock.calls[0]?.[1].env).toEqual({
      POSTGRES_DB: 'app',
      POSTGRES_PASSWORD: 'generated-secret',
    });
  });
});

function effectiveVariable(keyName: string, value: string): EffectiveVariable {
  return {
    keyName,
    scopeResourceName: 'postgres',
    scopeServiceName: null,
    scopeType: 'resource',
    sensitivity: 'sensitive',
    sourceResourceOutput: null,
    sourceType: 'direct',
    sourceVariableSetName: null,
    value,
  };
}

function resource(): ProjectResourceRow {
  return {
    commandJson: '[]',
    createdAt: new Date(),
    envJson: '[{"keyName":"POSTGRES_DB","literalValue":"app","sourceType":"literal","variableName":null}]',
    environmentId: 'env_prod',
    expectedClaimsJson: '[]',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'operation',
    operationsJson: '{}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime',
    status: 'running',
    updatedAt: new Date(),
    volumesJson: '[]',
  };
}

function context(): ResourceEnvironmentContext {
  return {
    environment: {
      createdAt: new Date(),
      id: 'env_prod',
      name: 'production',
      projectId: 'prj',
      updatedAt: new Date(),
    },
    organization: { id: 'org', name: 'Organization', slug: 'organization' },
    project: {
      archivedAt: null,
      createdAt: new Date(),
      id: 'prj',
      name: 'project',
      organizationId: 'org',
      updatedAt: new Date(),
    },
  };
}
