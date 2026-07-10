import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileModePermissions } from '@compartment/test-support';
import { describe, expect, it } from 'vitest';
import {
  createUpdateRuntimeTestHarness,
  generatedSelfHosted24ByteSecret,
  generatedSelfHostedAlternateVariablesMasterKey,
  generatedSelfHostedVariablesMasterKey,
  type InstallStateJsonObject,
  type ReconcileNodeAgentRuntimeNetworksInput,
  type TemporaryInstallPaths,
} from './update.test.harness';
import type { SelfHostedUpdateResult } from '../src/update.types';

const {
  createCurrentEnvironmentText,
  createTemporaryInstallPaths,
  mocks,
  removeEnvironmentAssignments,
  writeCurrentInstallFiles,
  writeInstallState,
  writeInstallStateJson,
  writeInvalidInstallStateWithoutInstallationId,
  writeManagedDomainInstallState,
} = createUpdateRuntimeTestHarness({ temporaryDirectoryPrefix: 'compartment-update-runtime-' });

describe.sequential('update runtime', (): void => {
  it('requires an existing install state before updating the runtime', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(installPaths, createCurrentEnvironmentText());
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      `Expected an existing self-hosted install state at ${join(installPaths.dataDir, 'self-hosted/install-state.json')}. Reinstall the runtime with \`compartment install\`.`,
    );
  });

  it('fails fast when the target directory does not contain a self-hosted environment', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      `Expected an existing self-hosted install environment at ${join(installPaths.configDir, '.env.self-hosted')}`,
    );
  });

  it.each([
    [
      'missing COMPARTMENT_ENV',
      removeEnvironmentAssignments(createCurrentEnvironmentText(), ['COMPARTMENT_ENV']),
      'The self-hosted environment is missing COMPARTMENT_ENV.',
    ],
    [
      'non-self-hosted COMPARTMENT_ENV',
      createCurrentEnvironmentText().replace('COMPARTMENT_ENV=self-hosted', 'COMPARTMENT_ENV=dev'),
      'The self-hosted environment has an invalid COMPARTMENT_ENV value: dev. Expected self-hosted.',
    ],
  ])(
    'rejects %s in existing env files before runtime mutation',
    async (_caseName: string, previousEnvironmentText: string, expectedError: string): Promise<void> => {
      const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
      await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
      await writeInstallState(installPaths, {
        imageSource: 'registry',
        installationId: '11111111-1111-4111-8111-111111111111',
        stateVersion: 1,
      });
      const { updateSelfHosted } = await import('../src/update');

      await expect(
        updateSelfHosted({
          options: {
            version: '1.2.3',
          },
        }),
      ).rejects.toThrow(expectedError);
      await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
        previousEnvironmentText,
      );
      expect(mocks.ensureDockerExecutionContext).not.toHaveBeenCalled();
      expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
      expect(mocks.stageNodeAgentHostService).not.toHaveBeenCalled();
      expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
      expect(mocks.reconcileNodeAgentRuntimeNetworks).not.toHaveBeenCalled();
    },
  );

  it('rejects unsafe generated secret values in existing env files before runtime mutation', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      variablesMasterKey: '1'.repeat(64),
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      'COMPARTMENT_VARIABLES_MASTER_KEY must not use one repeated hex character for self-hosted environments.',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.ensureDockerExecutionContext).not.toHaveBeenCalled();
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
    expect(mocks.stageNodeAgentHostService).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
    expect(mocks.reconcileNodeAgentRuntimeNetworks).not.toHaveBeenCalled();
  });

  it('updates a current install, preserves env values, and keeps installation metadata', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      acmeCaUrl: 'https://acme.zerossl.com/v2/DV90',
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      caddyTlsMode: 'managed',
      includeVariablesMasterKey: true,
      logLevel: 'debug',
      managedDomainBrokerToken: 'acme-token',
      managedDomainBrokerUrl: 'http://127.0.0.1:4545',
      nodeVersion: '0.1.0',
      publicIngressIpv4: '203.0.113.10',
      publicIngressIpv6: '2001:db8::10',
      publicProtocol: 'https',
      variablesMasterKey: generatedSelfHostedVariablesMasterKey,
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeManagedDomainInstallState(installPaths);
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageSource: 'registry',
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.currentVersion).toBe('0.1.0');
    expect(result.targetVersion).toBe('1.2.3');
    expect(result.imageRegistry).toBe('github');
    expect(result.imageSource).toBe('registry');
    expect(result.skipReason).toBeNull();
    expect(mocks.stopSelfHostedRuntime.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.stopNodeAgentHostService.mock.invocationCallOrder[0]!,
    );
    expect(mocks.stopNodeAgentHostService.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.stageNodeAgentHostService.mock.invocationCallOrder[0]!,
    );
    expect(mocks.stageNodeAgentHostService).toHaveBeenCalledWith({
      envPath: join(installPaths.configDir, '.env.self-hosted'),
      repairRuntimeWritableDirectoryContents: true,
    });
    expect(mocks.stageNodeAgentHostService.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartNodeAgentHostService.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.restartSelfHostedRuntime.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restartSelfHostedRuntime.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.waitForNodeAgentHostServiceHealth.mock.invocationCallOrder[0]!,
    );
    expect(mocks.waitForNodeAgentHostServiceHealth.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.reconcileNodeAgentRuntimeNetworks.mock.invocationCallOrder[0]!,
    );
    const reconcileInput: ReconcileNodeAgentRuntimeNetworksInput | undefined =
      mocks.reconcileNodeAgentRuntimeNetworks.mock.calls[0]?.[0];
    expect(reconcileInput?.environmentText).toContain('COMPARTMENT_NODE_VERSION=1.2.3');
    expect(reconcileInput?.environmentText).toContain('BUILDKIT_ADDR=unix:///run/buildkit/buildkitd.sock');
    expect(reconcileInput?.environmentText).not.toContain('BUILDKIT_ADDR=tcp://builder:1234');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_NODE_VERSION=1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'BUILDKIT_ADDR=unix:///run/buildkit/buildkitd.sock',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_UID=10001',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_GID=10001',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.not.toContain(
      'BUILDKIT_ADDR=tcp://builder:1234',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_BUILDER_IMAGE=ghcr.io/compartmentdev/compartment-builder:1.2.3',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_LOG_LEVEL=debug',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_DOCKER_NAMESPACE=compartment-test',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST=registry-auth',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT=5000',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_PROTOCOL=https',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_INGRESS_IPV4=203.0.113.10',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_PUBLIC_INGRESS_IPV6=2001:db8::10',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_CADDY_TLS_MODE=managed',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ACME_CA_URL=https://acme.zerossl.com/v2/DV90',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=http://127.0.0.1:4545',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=acme-token',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ACME_EMAIL=admin@example.com',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_DOCKER_WORK_DIR=${join(installPaths.dataDir, 'self-hosted/docker-work')}`,
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_VARIABLES_MASTER_KEY=${generatedSelfHostedVariablesMasterKey}`,
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_RUNTIME_CONTROL_TOKEN=${generatedSelfHosted24ByteSecret}`,
    );
    const backupDirectory: string = readRequiredBackupDirectory(result);
    await expect(readFile(join(backupDirectory, '.env.self-hosted'), 'utf8')).resolves.toBe(previousEnvironmentText);
    await expect(readMode(installPaths.configDir)).resolves.toBe(0o700);
    await expect(readMode(join(installPaths.configDir, '.env.self-hosted'))).resolves.toBe(0o600);
    await expect(readMode(backupDirectory)).resolves.toBe(0o700);
    await expect(readMode(join(backupDirectory, '.env.self-hosted'))).resolves.toBe(0o600);
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "github"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageSource": "registry"',
    );
    await expect(readMode(join(installPaths.dataDir, 'self-hosted'))).resolves.toBe(0o700);
    await expect(readMode(join(installPaths.dataDir, 'self-hosted/install-state.json'))).resolves.toBe(0o600);
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"installationId": "11111111-1111-4111-8111-111111111111"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"brokerUrl": "http://127.0.0.1:4545"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"managedDomainBrokerToken": "acme-token"',
    );
  });

  it('applies an already-current update when the rendered self-hosted environment needs migration', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        includeVariablesMasterKey: true,
        nodeVersion: '1.2.3',
        variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
      }),
    );
    await writeInstallState(installPaths, {
      imageRegistry: 'github',
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageSource: 'registry',
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.currentVersion).toBe('1.2.3');
    expect(result.targetVersion).toBe('1.2.3');
    expect(result.skipReason).toBeNull();
    expect(mocks.prepareSelfHostedRuntimeImages).toHaveBeenCalledTimes(1);
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'BUILDKIT_ADDR=unix:///run/buildkit/buildkitd.sock',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_UID=10001',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_RUNTIME_GID=10001',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.not.toContain(
      'BUILDKIT_ADDR=tcp://builder:1234',
    );
  });

  it('migrates legacy managed-domain broker env aliases and install-state tokens during update', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = `${removeEnvironmentAssignments(
      createCurrentEnvironmentText({
        baseDomain: '4h8z9k2m1p7q.app.compartment.run',
        caddyTlsMode: 'managed',
        includeVariablesMasterKey: true,
        publicProtocol: 'https',
      }),
      ['COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN', 'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL'],
    )}COMPARTMENT_ACME_DNS_BROKER_URL=http://127.0.0.1:4545
COMPARTMENT_ACME_DNS_TOKEN=legacy-token
`;
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallStateJson(installPaths, createLegacyManagedDomainInstallState());
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    const updatedEnvironmentText: string = await readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=http://127.0.0.1:4545');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=legacy-token');
    expect(updatedEnvironmentText).not.toContain('COMPARTMENT_ACME_DNS_BROKER_URL=');
    expect(updatedEnvironmentText).not.toContain('COMPARTMENT_ACME_DNS_TOKEN=');
    const updatedStateText: string = await readFile(
      join(installPaths.dataDir, 'self-hosted/install-state.json'),
      'utf8',
    );
    expect(updatedStateText).toContain('"managedDomainBrokerToken": "legacy-token"');
    expect(updatedStateText).not.toContain('acmeDnsToken');
  });

  it('leaves the current runtime files active when image preparation fails', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const previousStateText: string = await readFile(
      join(installPaths.dataDir, 'self-hosted/install-state.json'),
      'utf8',
    );
    mocks.prepareSelfHostedRuntimeImages.mockRejectedValueOnce(new Error('signature failed'));
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          imageSource: 'registry',
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('signature failed');

    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.yml'), 'utf8')).resolves.toBe(
      'services:\n',
    );
    await expect(readFile(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'), 'utf8')).resolves.toBe(
      'services:\n',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toBe(
      previousStateText,
    );
    await expect(stat(join(installPaths.dataDir, 'self-hosted/backups'))).rejects.toThrow();
  });

  it('persists applied install state before failing post-restart runtime network reconcile', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        includeVariablesMasterKey: true,
        nodeVersion: '0.1.0',
        variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
      }),
    );
    await writeInstallState(installPaths, {
      imageRegistry: 'github',
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    mocks.reconcileNodeAgentRuntimeNetworks.mockRejectedValueOnce(new Error('reconcile failed'));
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          imageRegistry: 'docker-hub',
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('reconcile failed');

    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_NODE_VERSION=1.2.3',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "docker-hub"',
    );
  });

  it('updates current registry installs to Docker Hub when explicitly selected', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        includeVariablesMasterKey: true,
        nodeVersion: '1.2.3',
        variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
      }),
    );
    await writeInstallState(installPaths, {
      imageRegistry: 'github',
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageRegistry: 'docker-hub',
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.currentVersion).toBe('1.2.3');
    expect(result.targetVersion).toBe('1.2.3');
    expect(result.imageRegistry).toBe('docker-hub');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=docker.io/compartmentdev/compartment-api:1.2.3',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "docker-hub"',
    );
  });

  it('persists explicit Docker Hub selection on legacy current registry states', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        includeVariablesMasterKey: true,
        nodeVersion: '1.2.3',
        variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
      }),
    );
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageRegistry: 'docker-hub',
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.currentVersion).toBe('1.2.3');
    expect(result.targetVersion).toBe('1.2.3');
    expect(result.imageRegistry).toBe('docker-hub');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=docker.io/compartmentdev/compartment-api:1.2.3',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "docker-hub"',
    );
  });

  it('migrates legacy registry states to GitHub without an override', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        includeVariablesMasterKey: true,
        nodeVersion: '1.2.3',
        variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
      }),
    );
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.currentVersion).toBe('1.2.3');
    expect(result.targetVersion).toBe('1.2.3');
    expect(result.imageRegistry).toBe('github');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=ghcr.io/compartmentdev/compartment-api:1.2.3',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "github"',
    );
  });

  it('reuses stored Docker Hub image registry without an override', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        includeVariablesMasterKey: true,
        variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
      }),
    );
    await writeInstallState(installPaths, {
      imageRegistry: 'docker-hub',
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.imageRegistry).toBe('docker-hub');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=docker.io/compartmentdev/compartment-api:1.2.3',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "docker-hub"',
    );
  });

  it('rejects registry update versions that do not match the packaged node agent binary', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText();
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          imageSource: 'registry',
          version: '9.9.9',
        },
      }),
    ).rejects.toThrow(
      'Host node-agent must come from the same packaged compartment CLI as the selected runtime version.',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('rejects already-current registry update versions that do not match the packaged node agent binary', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({ nodeVersion: '9.9.9' });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          imageSource: 'registry',
          version: '9.9.9',
        },
      }),
    ).rejects.toThrow(
      'Host node-agent must come from the same packaged compartment CLI as the selected runtime version.',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('reuses the stored image source on a fresh-install state baseline', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const existingEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      variablesMasterKey: generatedSelfHostedAlternateVariablesMasterKey,
    });
    await writeCurrentInstallFiles(installPaths, existingEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'local',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    expect(result.imageSource).toBe('local');
    expect(result.skipReason).toBeNull();
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      `COMPARTMENT_VARIABLES_MASTER_KEY=${generatedSelfHostedAlternateVariablesMasterKey}`,
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_API_IMAGE=docker.io/compartmentdev/compartment-api:1.2.3',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageRegistry": "docker-hub"',
    );
    await expect(readFile(join(installPaths.dataDir, 'self-hosted/install-state.json'), 'utf8')).resolves.toContain(
      '"imageSource": "local"',
    );
  });

  it('preserves activated custom HTTP domain runtime config during runtime updates', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(
      installPaths,
      createCurrentEnvironmentText({
        baseDomain: 'customer.example.com',
        caddyTlsMode: 'custom-http',
        includeVariablesMasterKey: true,
        publicProtocol: 'https',
      }),
    );
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    const updatedEnvironmentText: string = await readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_BASE_DOMAIN=customer.example.com');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_PUBLIC_PROTOCOL=https');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_CADDY_TLS_MODE=custom-http');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_ACME_CA_URL=');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=');
    expect(updatedEnvironmentText).toContain('COMPARTMENT_NODE_VERSION=1.2.3');
  });

  it('fails fast when the runtime control token is missing', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      includeRuntimeControlToken: false,
      includeVariablesMasterKey: true,
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('The self-hosted environment is missing COMPARTMENT_RUNTIME_CONTROL_TOKEN.');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
    expect(mocks.ensureDockerExecutionContext).not.toHaveBeenCalled();
    expect(mocks.prepareSelfHostedRuntimeImages).not.toHaveBeenCalled();
    expect(mocks.stageNodeAgentHostService).not.toHaveBeenCalled();
    expect(mocks.restartSelfHostedRuntime).not.toHaveBeenCalled();
    expect(mocks.reconcileNodeAgentRuntimeNetworks).not.toHaveBeenCalled();
  });

  it('rejects installs missing required system token env', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = removeEnvironmentAssignments(createCurrentEnvironmentText(), [
      'COMPARTMENT_SYSTEM_TOKEN',
    ]);
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('The self-hosted environment is missing COMPARTMENT_SYSTEM_TOKEN.');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('rejects installs missing the host node-agent socket during runtime updates', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = removeEnvironmentAssignments(createCurrentEnvironmentText(), [
      'COMPARTMENT_NODE_AGENT_SOCKET',
    ]);
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });

    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('The self-hosted environment is missing COMPARTMENT_NODE_AGENT_SOCKET.');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('migrates legacy system API socket paths while updating an environment', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText().replace(
      'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock',
      'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/system-api.sock',
    );
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });

    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result.status).toBe('updated');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock',
    );
  });

  it('rejects noncanonical host socket paths before updating an existing env', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText()
      .replace(
        'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock',
        'COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/custom-node/agent.sock',
      )
      .replace(
        'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock',
        'COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/custom-api/system-api.sock',
      );
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });

    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow(
      'The self-hosted environment has unsupported COMPARTMENT_NODE_AGENT_SOCKET value /var/run/compartment/custom-node/agent.sock. Expected /var/run/compartment/node/agent.sock.',
    );
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('rejects install state without installationId instead of rewriting it', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText();
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInvalidInstallStateWithoutInstallationId(installPaths);
    const { updateSelfHosted } = await import('../src/update');

    await expect(
      updateSelfHosted({
        options: {
          version: '1.2.3',
        },
      }),
    ).rejects.toThrow('Invalid self-hosted install state');
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('restages compose assets even when a current install is missing staged compose files', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    await writeCurrentInstallFiles(installPaths, createCurrentEnvironmentText());
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageSource: 'registry',
        version: '1.2.3',
      },
    });

    await expect(stat(join(installPaths.configDir, 'docker-compose.self-hosted.yml'))).resolves.toBeDefined();
    await expect(stat(join(installPaths.configDir, 'docker-compose.self-hosted.local.yml'))).resolves.toBeDefined();
    await expect(readFile(join(readRequiredBackupDirectory(result), '.env.self-hosted'), 'utf8')).resolves.toContain(
      'COMPARTMENT_ENV=self-hosted',
    );
  });

  it('skips the update when the requested release version is not newer', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      nodeVersion: '1.2.4',
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'registry',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        version: '1.2.3',
      },
    });

    expect(result).toEqual({
      backupDir: null,
      currentVersion: '1.2.4',
      imageRegistry: 'github',
      imageSource: 'registry',
      ...installPaths,
      skipReason: 'downgrade-not-supported',
      status: 'skipped',
      targetVersion: '1.2.3',
    });
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });

  it('reports downgrade-not-supported when a requested image-source switch also requires a downgrade', async (): Promise<void> => {
    const installPaths: TemporaryInstallPaths = await createTemporaryInstallPaths();
    const previousEnvironmentText: string = createCurrentEnvironmentText({
      includeVariablesMasterKey: true,
      nodeVersion: '1.2.4',
    });
    await writeCurrentInstallFiles(installPaths, previousEnvironmentText);
    await writeInstallState(installPaths, {
      imageSource: 'local',
      installationId: '11111111-1111-4111-8111-111111111111',
      stateVersion: 1,
    });
    const { updateSelfHosted } = await import('../src/update');

    const result: SelfHostedUpdateResult = await updateSelfHosted({
      options: {
        imageSource: 'registry',
        version: '1.2.3',
      },
    });

    expect(result).toEqual({
      backupDir: null,
      currentVersion: '1.2.4',
      imageRegistry: 'github',
      imageSource: 'registry',
      ...installPaths,
      skipReason: 'downgrade-not-supported',
      status: 'skipped',
      targetVersion: '1.2.3',
    });
    await expect(readFile(join(installPaths.configDir, '.env.self-hosted'), 'utf8')).resolves.toBe(
      previousEnvironmentText,
    );
  });
});

function readRequiredBackupDirectory(result: SelfHostedUpdateResult): string {
  if (result.backupDir !== null) {
    return result.backupDir;
  }

  throw new Error('Expected updateSelfHosted to create a backup directory.');
}

function createLegacyManagedDomainInstallState(): InstallStateJsonObject {
  return {
    imageSource: 'registry',
    installationId: '11111111-1111-4111-8111-111111111111',
    managedDomain: {
      acmeDnsToken: 'legacy-token',
      acmeEmail: 'admin@example.com',
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      brokerUrl: 'http://127.0.0.1:4545',
    },
    stateVersion: 1,
  };
}

async function readMode(path: string): Promise<number> {
  return readFileModePermissions((await stat(path)).mode);
}
