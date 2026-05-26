import { describe, expect, it } from 'vitest';
import {
  createUpdateRuntimeTestHarness,
  type InstallStateJsonObject,
  type TemporaryInstallPaths,
} from './update.test.harness';

interface InvalidEnvironmentUpdateCase {
  buildEnvironmentText: () => string;
  expectedMessage: string;
  name: string;
}

const {
  createCurrentEnvironmentText,
  createTemporaryInstallPaths,
  expectUpdateFailureLeavesEnvironment,
  removeEnvironmentAssignments,
  replaceEnvironmentAssignment,
  writeBaselineInstallState,
  writeCurrentInstallFiles,
  writeInstallStateJson,
} = createUpdateRuntimeTestHarness({ temporaryDirectoryPrefix: 'compartment-update-contract-' });

const invalidEnvironmentUpdateCases: InvalidEnvironmentUpdateCase[] = [
  {
    buildEnvironmentText: (): string =>
      removeEnvironmentAssignments(createCurrentEnvironmentText(), ['COMPARTMENT_DOCKER_NAMESPACE']),
    expectedMessage: 'The self-hosted environment is missing COMPARTMENT_DOCKER_NAMESPACE.',
    name: 'missing Docker namespace',
  },
  {
    buildEnvironmentText: (): string =>
      replaceEnvironmentAssignment(createCurrentEnvironmentText(), 'COMPARTMENT_DOCKER_NAMESPACE', ''),
    expectedMessage: 'The self-hosted environment is missing COMPARTMENT_DOCKER_NAMESPACE.',
    name: 'blank Docker namespace',
  },
  {
    buildEnvironmentText: (): string =>
      removeEnvironmentAssignments(createCurrentEnvironmentText(), ['COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD']),
    expectedMessage: 'The self-hosted environment is missing COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD.',
    name: 'missing registry credential',
  },
  {
    buildEnvironmentText: (): string =>
      replaceEnvironmentAssignment(createCurrentEnvironmentText(), 'COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME', ''),
    expectedMessage: 'The self-hosted environment is missing COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME.',
    name: 'blank registry credential',
  },
  {
    buildEnvironmentText: (): string =>
      `${removeEnvironmentAssignments(createCurrentEnvironmentText(), [
        'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN',
        'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL',
      ])}COMPARTMENT_ACME_DNS_TOKEN=legacy-token\nCOMPARTMENT_ACME_DNS_BROKER_URL=http://127.0.0.1:4545\n`,
    expectedMessage: 'The self-hosted environment is missing COMPARTMENT_MANAGED_DOMAIN_BROKER_URL.',
    name: 'legacy broker alias-only env',
  },
];

describe.sequential('strict self-hosted update contract', (): void => {
  for (const updateCase of invalidEnvironmentUpdateCases) {
    it(`rejects ${updateCase.name} before runtime mutation`, async (): Promise<void> => {
      expect.hasAssertions();
      const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
      const previousEnvironmentText: string = updateCase.buildEnvironmentText();
      await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
      await writeBaselineInstallState(installPaths);

      await expectUpdateFailureLeavesEnvironment(installPaths, previousEnvironmentText, updateCase.expectedMessage);
    });
  }

  it('rejects legacy managed domain install state instead of dropping it', async (): Promise<void> => {
    expect.hasAssertions();
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      managedDomainBrokerToken: 'acme-token',
      managedDomainBrokerUrl: 'http://127.0.0.1:4545',
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallStateJson(installPaths, createLegacyManagedDomainInstallState());

    await expectUpdateFailureLeavesEnvironment(
      installPaths,
      previousEnvironmentText,
      'Invalid self-hosted install state',
    );
  });
});

function createLegacyManagedDomainInstallState(): InstallStateJsonObject {
  return {
    imageSource: 'registry',
    installationId: '11111111-1111-4111-8111-111111111111',
    managedDomain: {
      acmeDnsToken: 'acme-token',
      acmeEmail: 'admin@example.com',
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      brokerUrl: 'http://127.0.0.1:4545',
    },
    stateVersion: 1,
  };
}
