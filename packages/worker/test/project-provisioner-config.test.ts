import { describe, expect, it } from 'vitest';
import { readProjectProvisionerConfig } from '../src/project-provisioner-config';
import type { ProjectProvisionerConfig } from '../src/project-provisioner.types';
import { testEdgePodLabels, testEdgePodLabelsJson } from './worker-config-test.fixtures';

const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');

describe('readProjectProvisionerConfig', (): void => {
  it('starts without worker controller-only custom-domain configuration', (): void => {
    const config: ProjectProvisionerConfig = readProjectProvisionerConfig(projectProvisionerEnvironment());

    expect(config).toEqual({
      apiUrl: 'http://compartment-api:39444',
      artifactRegistry: {
        address: 'registry.compartment.localhost:443',
        credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
        internalAddress: 'compartment-registry:5000',
        internalUrl: 'http://compartment-registry:5000',
      },
      edgeNamespace: 'compartment',
      edgePodLabels: testEdgePodLabels,
      image: 'registry.internal/compartment-worker@sha256:worker',
      installationId: 'inst_1',
      leaderElection: {
        identity: 'project-provisioner-1',
        leaseDurationMs: 15000,
        leaseName: 'compartment-project-provisioner',
        namespace: 'compartment',
        renewDeadlineMs: 10000,
        retryPeriodMs: 2000,
      },
      logLevel: 'info',
      platformNamespace: 'compartment',
      podCidr,
      pollIntervalMs: 1000,
      provisioningNamespace: 'compartment-project-provisioning',
      runtimeControlToken: 'runtime-control-token',
      serviceCidr,
      workerServiceAccountName: 'compartment-worker',
    });
  });

  it('parses tenant scheduling for provisioning Jobs', (): void => {
    const config: ProjectProvisionerConfig = readProjectProvisionerConfig({
      ...projectProvisionerEnvironment(),
      COMPARTMENT_KUBE_TENANT_SCHEDULING: JSON.stringify({
        nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
        runtimeClassName: 'gvisor',
        tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Exists' }],
      }),
    });

    expect(config.tenantScheduling).toEqual({
      nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
      runtimeClassName: 'gvisor',
      tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Exists' }],
    });
  });
});

function projectProvisionerEnvironment(): NodeJS.ProcessEnv {
  return {
    COMPARTMENT_API_INTERNAL_HOST: 'compartment-api',
    COMPARTMENT_API_PORT: '39444',
    COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: 'registry-signing-key-with-at-least-32-characters',
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: 'registry.compartment.localhost',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: 'compartment-registry:5000',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: 'http://compartment-registry:5000',
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: '443',
    COMPARTMENT_EDGE_NAMESPACE: 'compartment',
    COMPARTMENT_EDGE_POD_LABELS: testEdgePodLabelsJson,
    COMPARTMENT_INSTALLATION_ID: 'inst_1',
    COMPARTMENT_KUBE_POD_CIDR: podCidr,
    COMPARTMENT_KUBE_SERVICE_CIDR: serviceCidr,
    COMPARTMENT_LOG_LEVEL: 'info',
    COMPARTMENT_LEADER_ELECTION_IDENTITY: 'project-provisioner-1',
    COMPARTMENT_LEADER_ELECTION_LEASE_DURATION_MS: '15000',
    COMPARTMENT_LEADER_ELECTION_RENEW_DEADLINE_MS: '10000',
    COMPARTMENT_LEADER_ELECTION_RETRY_PERIOD_MS: '2000',
    COMPARTMENT_PLATFORM_NAMESPACE: 'compartment',
    COMPARTMENT_PROJECT_PROVISIONER_IMAGE: 'registry.internal/compartment-worker@sha256:worker',
    COMPARTMENT_PROVISIONING_NAMESPACE: 'compartment-project-provisioning',
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
    COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
    COMPARTMENT_USAGE_METERING_INTERVAL_MS: '60000',
    COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: 'compartment-worker',
  };
}
