import { readFile, stat, writeFile } from 'node:fs/promises';
import type { ManagedDomainReservationRequest } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { createCommandProgress } from '../src/commands/command.progress';
import { deployAndWaitForKubernetesInstall } from '../src/services/kubernetes-install.service';
import { runKubernetesHelmInstallStage } from '../src/services/kubernetes-install-helm.service';
import { buildResolvedInstallValues } from '../src/services/kubernetes-install-state.service';
import { waitForPublicControlPlane } from '../src/services/kubernetes-install-public.service';
import { readRetainedKubernetesInstallState } from '../src/services/kubernetes-install-retained-state.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
  KubernetesInstallRegistryValues,
  KubernetesInstallSecretValues,
  KubernetesInstallState,
  KubernetesIngressEndpoint,
} from '../src/services/kubernetes-install.service.types';
import type { CommandProgress } from '../src/commands/command.progress.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';
import {
  createFetchConnectionError,
  deployedReleaseList,
  helmReleaseList,
  type ImageTrustWriteInput,
  type InstallHarnessState,
  type KubernetesInstallServiceMocks,
  ingressAddressList,
  readyControlPlaneResponse,
  RecordingProgressReporter,
  retainedInstallStateSecretList,
  type RunCommandCall,
  successfulCommandResult,
} from './kubernetes-install.service.test-support';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
const mocks: KubernetesInstallServiceMocks = vi.hoisted(
  (): KubernetesInstallServiceMocks => ({
    runCommand: vi.fn<RunCommand>(),
    verifyRegistryNodePull: vi.fn(async (): Promise<void> => await Promise.resolve()),
    usesOperatorTlsSecret: vi.fn(async (): Promise<boolean> => await Promise.resolve(false)),
    writeVerifiedImages: vi.fn(async (input: ImageTrustWriteInput): Promise<void> => {
      await writeFile(input.outputPath, JSON.stringify({ images: {} }), { mode: 0o600 });
    }),
  }),
);
const detectedPublicIpv4: string = [8, 8, 8, 8].join('.');
const configuredPublicIpv4: string = [8, 8, 4, 4].join('.');
process.env.COMPARTMENT_MANAGED_DOMAIN_RESERVATION_TOKEN = 'test-reservation-token';

vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
  runCommandWithTimeout: mocks.runCommand,
}));
vi.mock('../src/services/kubernetes-image-trust.service', (): object => ({
  writeVerifiedKubernetesInstallImageValues: mocks.writeVerifiedImages,
}));
vi.mock('../src/services/kubernetes-install-registry-verification.service', (): object => ({
  verifyKubernetesInstallRegistryNodePull: mocks.verifyRegistryNodePull,
}));
vi.mock('../src/services/kubernetes-install-tls.service', (): object => ({
  usesOperatorOwnedKubernetesTlsSecret: mocks.usesOperatorTlsSecret,
}));

const managedDeploymentInput: KubernetesInstallDeploymentInput = {
  acmeEmail: 'admin@example.com',
  brokerUrl: 'https://broker.compartment.run',
  chartPath: '/tmp/compartment-chart',
  domainMode: 'managed',
  managedDomainRequestedLabelSource: 'Acme Dev',
  namespace: 'compartment',
  registryHostname: 'registry.acme.compartment.run',
  registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
  releaseName: 'compartment',
  valuesPath: '/tmp/compartment-values.yaml',
};

describe('Kubernetes install deployment', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
    mocks.verifyRegistryNodePull.mockClear();
    mocks.usesOperatorTlsSecret.mockReset();
    mocks.usesOperatorTlsSecret.mockResolvedValue(false);
    mocks.writeVerifiedImages.mockClear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects incomplete registry values before starting a full Helm install', (): void => {
    const state: KubernetesInstallState = {
      ...readRetainedState(existingInstallValues('foundation', 'custom')),
      registryHostname: '',
    };

    expect((): KubernetesInstallSecretValues => buildResolvedInstallValues(state, 'install-token')).toThrow(
      'Cannot start the full Helm installation without a resolved private registry hostname.',
    );
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });

  it('allocates a managed domain from the LoadBalancer address before the final Helm render', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const brokerRequests: RequestInit[] = [];
    stubManagedInstallFetch(state.events, brokerRequests);

    const result: KubernetesInstallDeploymentResult = await deployAndWaitForKubernetesInstall(managedDeploymentInput);

    expect(result).toMatchObject({
      apiUrl: 'https://console.acme.compartment.run',
      baseDomain: 'acme.compartment.run',
    });
    expect(result.installToken).toMatch(/^[\da-f]{64}$/u);
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.events).toEqual([
      'helm:foundation',
      'kubectl:ingress',
      'broker:allocate',
      'broker:bind',
      'helm:foundation',
      'helm:full',
      'kubectl:certificate',
    ]);
    const brokerRequest: ManagedDomainReservationRequest = readBrokerRequest(brokerRequests);
    expect(brokerRequest).toMatchObject({ requestedLabelSource: 'Acme Dev' });
    expect(readResolvedInstallValues(state)).toMatchObject({
      platform: {
        baseDomain: 'acme.compartment.run',
        managedDomainAllocationId: 'allocation-1',
        publicProtocol: 'https',
        tlsMode: 'broker-dns01',
      },
      secrets: { managedDomainBrokerToken: 'allocation-token' },
    });
    expect(state.installValueModes).toEqual([0o600, 0o600, 0o600]);
    expect(readCommandText()).not.toContain(result.installToken);
    expect(readCommandText()).not.toContain('acme-token');
    await expect(readFile(state.installValuePaths[0]!, 'utf8')).rejects.toThrow();
  });

  it('retries transient broker failures with the same installation identity', async (): Promise<void> => {
    vi.useFakeTimers();
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const brokerRequests: RequestInit[] = [];
    let brokerAttempt: number = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (readFetchUrl(input).startsWith('https://broker.compartment.run')) {
          brokerRequests.push(init ?? {});
          if (readFetchUrl(input).endsWith('/targets')) {
            return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
          }
          brokerAttempt += 1;
          if (brokerAttempt < 3) {
            return await Promise.resolve(new Response('', { status: 502 }));
          }
          return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
        }
        return await Promise.resolve(readyControlPlaneResponse());
      }),
    );

    const install: Promise<KubernetesInstallDeploymentResult> =
      deployAndWaitForKubernetesInstall(managedDeploymentInput);
    await vi.waitFor((): void => {
      expect(brokerAttempt).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(install).resolves.toMatchObject({ baseDomain: 'acme.compartment.run' });
    expect(brokerRequests).toHaveLength(4);
    expect(brokerRequests.slice(0, 3).map(readBrokerRequestBody)).toEqual([
      readBrokerRequestBody(brokerRequests[0]!),
      readBrokerRequestBody(brokerRequests[0]!),
      readBrokerRequestBody(brokerRequests[0]!),
    ]);
  });

  it('retries a reset broker connection and exposes the retry event', async (): Promise<void> => {
    vi.useFakeTimers();
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const brokerRequests: RequestInit[] = [];
    const retryEvents: string[] = [];
    let brokerAttempt: number = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (!readFetchUrl(input).startsWith('https://broker.compartment.run')) {
          return await Promise.resolve(readyControlPlaneResponse());
        }
        brokerRequests.push(init ?? {});
        if (readFetchUrl(input).endsWith('/targets')) {
          return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
        }
        brokerAttempt += 1;
        if (brokerAttempt === 1) {
          throw createFetchConnectionError('ECONNRESET');
        }
        return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
      }),
    );

    const install: Promise<KubernetesInstallDeploymentResult> = deployAndWaitForKubernetesInstall({
      ...managedDeploymentInput,
      progress: new RecordingProgressReporter(retryEvents),
    });
    await vi.waitFor((): void => {
      expect(brokerAttempt).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(install).resolves.toMatchObject({ baseDomain: 'acme.compartment.run' });
    expect(brokerRequests.slice(0, 2).map(readBrokerRequestBody)).toEqual([
      readBrokerRequestBody(brokerRequests[0]!),
      readBrokerRequestBody(brokerRequests[0]!),
    ]);
    expect(retryEvents).toContainEqual(expect.stringContaining('transient failure on attempt 1/4; retrying'));
  });

  it('retries broker rate limiting', async (): Promise<void> => {
    vi.useFakeTimers();
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    let brokerAttempt: number = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        if (!readFetchUrl(input).startsWith('https://broker.compartment.run')) {
          return await Promise.resolve(readyControlPlaneResponse());
        }
        if (readFetchUrl(input).endsWith('/targets')) {
          return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
        }
        brokerAttempt += 1;
        return await Promise.resolve(
          brokerAttempt === 1 ? new Response('', { status: 429 }) : managedBrokerResponse(readFetchUrl(input)),
        );
      }),
    );

    const install: Promise<KubernetesInstallDeploymentResult> =
      deployAndWaitForKubernetesInstall(managedDeploymentInput);
    await vi.waitFor((): void => {
      expect(brokerAttempt).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(install).resolves.toMatchObject({ baseDomain: 'acme.compartment.run' });
    expect(brokerAttempt).toBe(2);
  });

  it('reports request context and resume advice after exhausting broker retries', async (): Promise<void> => {
    vi.useFakeTimers();
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const retryEvents: string[] = [];
    const brokerFetch: Mock<(input: string | URL | Request) => Promise<Response>> = vi.fn(
      async (): Promise<Response> =>
        await Promise.resolve(new Response('', { headers: { 'x-request-id': 'req_retry_123' }, status: 502 })),
    );
    vi.stubGlobal('fetch', brokerFetch);

    const install: Promise<KubernetesInstallDeploymentResult> = deployAndWaitForKubernetesInstall({
      ...managedDeploymentInput,
      progress: new RecordingProgressReporter(retryEvents),
    });
    const failure: Promise<void> = expect(install).rejects.toThrow(
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains/allocations failed with status 502 (request-id: req_retry_123); transient failure after 4 attempts while attempting to reserve managed domain. Re-run install to resume.',
    );
    await vi.waitFor((): void => {
      expect(brokerFetch).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(20_000);

    await failure;
    expect(brokerFetch).toHaveBeenCalledTimes(4);
    expect(retryEvents.filter((event: string): boolean => event.includes('retrying'))).toHaveLength(3);
  });

  it('does not retry broker 4xx responses and reports actionable request context', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const brokerFetch: Mock<(input: string | URL | Request) => Promise<Response>> = vi.fn(
      async (): Promise<Response> =>
        await Promise.resolve(new Response('', { headers: { 'x-request-id': 'req_invalid_123' }, status: 400 })),
    );
    vi.stubGlobal('fetch', brokerFetch);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow(
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains/allocations failed with status 400 (request-id: req_invalid_123) while attempting to reserve managed domain. Check the install configuration before re-running install.',
    );
    expect(brokerFetch).toHaveBeenCalledTimes(1);
  });

  it('emits observable install phases in execution order', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    stubManagedInstallFetch(state.events, []);
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: false });
    const progress: CommandProgress = createCommandProgress({ io: capture.io, output: 'text' });

    await deployAndWaitForKubernetesInstall({
      ...managedDeploymentInput,
      progress,
    });
    const progressEvents: string[] = readCliStderr(capture).trim().split('\n');

    expect(progressEvents.filter((event: string): boolean => event.includes('\u2713'))).toEqual([
      expect.stringMatching(/^Inspecting existing installation.* \u2713 /u),
      expect.stringMatching(/^Preparing Helm chart and verifying images.* \u2713 /u),
      expect.stringMatching(/^Installing foundation \(postgres, registry\).* \u2713 /u),
      expect.stringMatching(/^Waiting for Ingress endpoint.* \u2713 .*8\.8\.8\.8/u),
      expect.stringMatching(/^Requesting managed domain.* \u2713 /u),
      expect.stringMatching(/^Binding managed-domain DNS targets.* \u2713 /u),
      expect.stringMatching(/^Saving installation configuration.* \u2713 /u),
      expect.stringMatching(/^Waiting for platform Certificates.* \u2713 /u),
      expect.stringMatching(/^Waiting for platform pods \(api, worker, caddy\).* \u2713 /u),
      expect.stringMatching(/^Verifying private registry pull on every node.* \u2713 /u),
      expect.stringMatching(/^Issuing TLS certificate \(ACME\).* \u2713 /u),
    ]);
    expect(readCliStderr(capture)).not.toContain('\u001B');
  });

  it('resumes persisted managed allocation state without reserving again', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(existingInstallValues('foundation', 'managed'));
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const fetchMock: Mock<(url: string) => Promise<Response>> = vi.fn(async (url: string): Promise<Response> => {
      if (url.startsWith('https://broker.compartment.run')) {
        return await Promise.resolve(managedBrokerResponse(url));
      }
      return await Promise.resolve(readyControlPlaneResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.events).toEqual(['helm:foundation', 'helm:foundation', 'helm:full', 'kubectl:certificate']);
  });

  it('backfills registry identity while resuming a legacy operator foundation release', async (): Promise<void> => {
    const releaseValues: string = legacyOperatorFoundationValues();
    const retainedState: KubernetesInstallState = {
      ...readRetainedState(existingInstallValues('foundation', 'custom')),
      registryHostname: '',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: '' },
    };
    const state: InstallHarnessState = createInstallHarnessState(releaseValues, retainedState);
    state.retainedSecretOutput = retainedInstallStateSecretList(retainedState, false);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, configuredPublicIpv4));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse())),
    );
    const customInput: KubernetesInstallDeploymentInput = {
      ...managedDeploymentInput,
      apiUrl: 'https://console.apps.example.com',
      baseDomain: 'apps.example.com',
      brokerUrl: undefined,
      domainMode: 'custom',
      managedDomainRequestedLabelSource: undefined,
      registryHostname: 'registry.apps.example.com',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    };

    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toMatchObject({
      baseDomain: 'apps.example.com',
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.installValues[0]).toMatchObject({
      platform: { installationId: 'installation-123' },
      registry: {
        hostname: 'registry.apps.example.com',
        issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      },
      secrets: { installToken: 'existing-install-token' },
    });
    expect(state.retainedState).toMatchObject({
      registryHostname: 'registry.apps.example.com',
      registryIssuerRef: { kind: 'Issuer', name: 'compartment-platform' },
    });
  });

  it('reuses retained allocation state after the Helm release was removed', async (): Promise<void> => {
    const retainedState: KubernetesInstallState = readRetainedState(existingInstallValues('full', 'managed'));
    const state: InstallHarnessState = createInstallHarnessState(null, retainedState);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        if (readFetchUrl(input).startsWith('https://broker.compartment.run')) {
          return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
        }
        return await Promise.resolve(readyControlPlaneResponse());
      }),
    );

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
    });
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.installValues[0]?.platform.installationId).toBe('installation-123');
    expect(readResolvedInstallValues(state).platform.managedDomainBrokerUrl).toBe('https://broker.compartment.run');
  });

  it('keeps the broker URL that owns a retained managed allocation', async (): Promise<void> => {
    const retainedState: KubernetesInstallState = {
      ...readRetainedState(existingInstallValues('foundation', 'managed')),
      brokerUrl: 'https://previous-broker.example.com',
    };
    const state: InstallHarnessState = createInstallHarnessState(
      existingInstallValues('foundation', 'managed'),
      retainedState,
    );
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        if (readFetchUrl(input).includes('/v1/managed-domains')) {
          return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
        }
        return await Promise.resolve(readyControlPlaneResponse());
      }),
    );

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
    });
    expect(readResolvedInstallValues(state).platform.managedDomainBrokerUrl).toBe(
      'https://previous-broker.example.com',
    );
  });

  it('observes Ingress status when a retained foundation has no endpoint', async (): Promise<void> => {
    const releaseValues: string = managedInstallValuesWithoutIngress();
    const state: InstallHarnessState = createInstallHarnessState(releaseValues);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, configuredPublicIpv4));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        if (readFetchUrl(input).includes('/v1/managed-domains')) {
          return await Promise.resolve(managedBrokerResponse(readFetchUrl(input)));
        }
        return await Promise.resolve(readyControlPlaneResponse());
      }),
    );

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
    });
    expect(state.events).toEqual([
      'helm:foundation',
      'kubectl:ingress',
      'helm:foundation',
      'helm:full',
      'kubectl:certificate',
    ]);
    expect(readResolvedInstallValues(state)).toMatchObject({
      ingress: { endpoint: { type: 'A', value: detectedPublicIpv4 } },
    });
  });

  it('resumes owner bootstrap without rendering an existing full release', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(existingInstallValues('full', 'managed'));
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse())),
    );

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toEqual({
      apiUrl: 'https://console.acme.compartment.run',
      baseDomain: 'acme.compartment.run',
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual([]);
    expect(state.events).toEqual(['kubectl:certificate']);
  });

  it('rechecks Certificate readiness when resuming after a full-stage timeout', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    const baseHandler: RunCommand = createInstallCommandHandler(state);
    mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
      if (command.includes('certificates.cert-manager.io')) {
        state.events.push('kubectl:certificate');
        return {
          exitCode: 1,
          stderr: 'timed out waiting for the condition on certificates/compartment-console',
          stdout: '',
        };
      }
      return await baseHandler(command);
    });
    stubManagedInstallFetch(state.events, []);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow(
      'the installation remains incomplete',
    );
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow(
      'the installation remains incomplete',
    );
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.events.filter((event: string): boolean => event === 'kubectl:certificate')).toHaveLength(2);
  });

  it('rejects a preview release without canonical retained install state', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(existingInstallValues('full', 'custom'), null);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const customInput: KubernetesInstallDeploymentInput = {
      ...managedDeploymentInput,
      apiUrl: 'https://console.apps.example.com',
      baseDomain: 'apps.example.com',
      brokerUrl: undefined,
      domainMode: 'custom',
      managedDomainRequestedLabelSource: undefined,
      registryHostname: 'registry.apps.example.com',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'customer-platform' },
    };

    await expect(deployAndWaitForKubernetesInstall(customInput)).rejects.toThrow(
      'The existing Helm release has no canonical retained install state.',
    );
    expect(readHelmStages()).toEqual([]);
  });

  it('derives an HTTP Console URL for a retained localhost installation', async (): Promise<void> => {
    const releaseValues: string = existingLocalhostInstallValues();
    const state: InstallHarnessState = createInstallHarnessState(releaseValues);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse())),
    );
    const customInput: KubernetesInstallDeploymentInput = {
      ...managedDeploymentInput,
      baseDomain: 'compartment.localhost',
      brokerUrl: undefined,
      domainMode: 'custom',
      managedDomainRequestedLabelSource: undefined,
    };

    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toMatchObject({
      apiUrl: 'http://console.compartment.localhost',
    });
  });

  it('preserves a custom ingress address and skips Certificate wait for an operator TLS Secret', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, configuredPublicIpv4));
    mocks.usesOperatorTlsSecret.mockResolvedValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse())),
    );
    const customInput: KubernetesInstallDeploymentInput = {
      ...managedDeploymentInput,
      apiUrl: 'https://console.apps.example.com',
      baseDomain: 'apps.example.com',
      brokerUrl: undefined,
      domainMode: 'custom',
      managedDomainRequestedLabelSource: undefined,
      registryHostname: 'registry.apps.example.com',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'customer-platform' },
    };

    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toMatchObject({
      baseDomain: 'apps.example.com',
    });
    expect(state.events).toEqual(['helm:foundation', 'helm:foundation', 'helm:full']);
    expect(readResolvedInstallValues(state).ingress?.targetsJson).toContain(configuredPublicIpv4);
    expect(readResolvedInstallValues(state)).toMatchObject({
      platform: {
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        publicProtocol: 'https',
      },
      registry: {
        hostname: 'registry.apps.example.com',
        issuerRef: { kind: 'Issuer', name: 'customer-platform' },
      },
    });
    expect(mocks.usesOperatorTlsSecret).toHaveBeenCalledWith(customInput.valuesPath);
  });

  it('removes temporary secret values after a final Helm failure', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, '', true));
    stubManagedInstallFetch(state.events, []);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow('upgrade failed');
    expect(readCommandText()).not.toContain('acme-token');
    await expect(readFile(state.installValuePaths[0]!, 'utf8')).rejects.toThrow();
  });

  it('retries allocation with the same installation identity after state persistence fails', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, '', false, true));
    const brokerRequests: RequestInit[] = [];
    stubManagedInstallFetch(state.events, brokerRequests);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow(
      'Helm foundation install failed',
    );
    const retainedInstallationId: string | undefined = state.retainedState?.installationId;
    expect(retainedInstallationId).toMatch(/^[\da-f-]{36}$/u);
    expect(state.retainedState).toMatchObject({ baseDomain: '', managedDomainBrokerToken: '' });

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
    });
    expect(
      brokerRequests
        .map(readBrokerRequestBody)
        .filter((request: ManagedDomainReservationRequest): boolean => 'installationId' in request)
        .map((request: ManagedDomainReservationRequest): string => request.installationId),
    ).toEqual([retainedInstallationId, retainedInstallationId]);
    expect(state.retainedState).toMatchObject({
      baseDomain: 'acme.compartment.run',
      managedDomainBrokerToken: 'allocation-token',
    });
  });

  it('rejects a configured private ingress address before broker allocation', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, [10, 0, 0, 1].join('.')));
    const fetchMock: Mock<(input: string | URL | Request) => Promise<Response>> = vi.fn(
      async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse()),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow(
      'ingress.endpoint must contain a public A or AAAA address, or a valid hostname',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists a managed allocation before rejecting a mismatched Console URL', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    stubManagedInstallFetch(state.events, []);

    await expect(
      deployAndWaitForKubernetesInstall({
        ...managedDeploymentInput,
        apiUrl: 'https://console.wrong.example.com',
      }),
    ).rejects.toThrow('--api-url must use the control-plane host console.acme.compartment.run.');
    expect(readHelmStages()).toEqual(['foundation', 'foundation']);
    expect(state.retainedState).toMatchObject({
      baseDomain: 'acme.compartment.run',
      managedDomainBrokerToken: 'allocation-token',
    });
  });

  it.each(['failed', 'pending-upgrade', 'uninstalled'])(
    'rejects a Helm release with status %s',
    async (status: string): Promise<void> => {
      mocks.runCommand.mockResolvedValueOnce(successfulCommandResult(helmReleaseList(status)));
      await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow(
        `existing Helm release compartment has status ${status}`,
      );
    },
  );

  it('bounds the initial cluster inspection and explains how to recover', async (): Promise<void> => {
    const progressEvents: string[] = [];
    mocks.runCommand.mockResolvedValueOnce({
      exitCode: 124,
      stderr: 'Command timed out after 30 seconds.',
      stdout: '',
    });

    await expect(
      deployAndWaitForKubernetesInstall({
        ...managedDeploymentInput,
        progress: new RecordingProgressReporter(progressEvents),
      }),
    ).rejects.toThrow(
      'Timed out after 30s during Helm release lookup. Check that the Kubernetes API is reachable for the selected context, then re-run install to resume.',
    );
    expect(progressEvents).toEqual(['Inspecting existing installation\u2026']);
  });
});

describe('Kubernetes Helm install timeout diagnostics', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
  });

  it('reports non-Ready pods and a recovery command after the Helm timeout', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'context deadline exceeded', stdout: '' })
      .mockResolvedValueOnce(
        successfulCommandResult(
          JSON.stringify({
            items: [
              {
                metadata: { name: 'compartment-api-123' },
                status: { conditions: [{ status: 'False', type: 'Ready' }], phase: 'Pending' },
              },
            ],
          }),
        ),
      );

    await expect(
      runKubernetesHelmInstallStage(
        managedDeploymentInput,
        '/tmp/chart',
        '/tmp/platform-images.yaml',
        '/tmp/install-values.json',
        '/tmp/image-trust.yaml',
        'full',
      ),
    ).rejects.toThrow(
      'Non-Ready pods: compartment-api-123 (Pending). Check with `kubectl get pods -n compartment` and re-run install to resume.',
    );
    expect(mocks.runCommand.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(['--timeout', '8m']));
  });
});

describe('Kubernetes public control-plane readiness', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('times out with the observed response and recovery advice', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(new Response('', { status: 502 }))),
    );
    const readiness: Promise<void> = waitForPublicControlPlane('https://console.apps.example.com');
    const failure: Promise<void> = expect(readiness).rejects.toThrow(
      'Public Compartment control plane at https://console.apps.example.com was not ready after 300s: HTTP 502 with location <none>. Check DNS, ports 80/443, and the TLS certificate status, then re-run install to resume.',
    );

    await vi.advanceTimersByTimeAsync(300_000);
    await failure;
  });
});

describe('retained Kubernetes install state discovery', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
  });

  it('treats a missing target namespace as a fresh install', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue({
      exitCode: 1,
      stderr: 'Error from server (NotFound): namespaces "new-compartment" not found',
      stdout: '',
    });

    await expect(
      readRetainedKubernetesInstallState({
        ...managedDeploymentInput,
        namespace: 'new-compartment',
      }),
    ).resolves.toBeNull();
  });

  it('does not hide authorization failures while reading retained state', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue({
      exitCode: 1,
      stderr: 'Error from server (Forbidden): secrets is forbidden',
      stdout: '',
    });

    await expect(readRetainedKubernetesInstallState(managedDeploymentInput)).rejects.toThrow(
      'Failed to inspect retained Kubernetes install state',
    );
  });
});

function createInstallHarnessState(
  releaseValues: string | null = null,
  retainedState: KubernetesInstallState | null | undefined = undefined,
): InstallHarnessState {
  return {
    events: [],
    installValueModes: [],
    installValuePaths: [],
    installValues: [],
    releaseValues,
    retainedSecretOutput: null,
    retainedState:
      retainedState === undefined && releaseValues !== null
        ? readRetainedState(releaseValues)
        : (retainedState ?? null),
  };
}

function createInstallCommandHandler(
  state: InstallHarnessState,
  configuredIpv4: string = '',
  failFull: boolean = false,
  failResolvedFoundation: boolean = false,
): RunCommand {
  return async (command: readonly string[]): Promise<CommandResult> => {
    if (command[0] === 'kubectl') {
      if (command.includes('secret')) {
        return successfulCommandResult(
          state.retainedSecretOutput ?? retainedInstallStateSecretList(state.retainedState),
        );
      }
      if (command.includes('certificates.cert-manager.io')) {
        state.events.push('kubectl:certificate');
        return successfulCommandResult('');
      }
      state.events.push('kubectl:ingress');
      return successfulCommandResult(ingressAddressList([detectedPublicIpv4]));
    }
    if (command[1] === 'list') {
      return successfulCommandResult(state.releaseValues === null ? '[]' : deployedReleaseList());
    }
    if (command[1] === 'get') {
      return successfulCommandResult(state.releaseValues ?? '{}');
    }
    return await handleHelmUpgrade(state, command, configuredIpv4, failFull, failResolvedFoundation);
  };
}

async function handleHelmUpgrade(
  state: InstallHarnessState,
  command: readonly string[],
  configuredIpv4: string,
  failFull: boolean,
  failResolvedFoundation: boolean,
): Promise<CommandResult> {
  const installValuesPath: string = readOptionValueFromEnd(command, '--values', 2);
  const values: KubernetesInstallSecretValues = JSON.parse(
    await readFile(installValuesPath, 'utf8'),
  ) as KubernetesInstallSecretValues;
  const stage: string = readLastOptionValue(command, '--set').split('=')[1]!;
  state.events.push(`helm:${stage}`);
  state.installValueModes.push((await stat(installValuesPath)).mode & 0o777);
  state.installValuePaths.push(installValuesPath);
  state.installValues.push(values);
  if (
    failResolvedFoundation &&
    stage === 'foundation' &&
    state.events.filter((event: string): boolean => event === 'helm:foundation').length === 2
  ) {
    return { exitCode: 1, stderr: 'upgrade failed', stdout: '' };
  }
  if (failFull && stage === 'full') {
    return { exitCode: 1, stderr: 'upgrade failed', stdout: '' };
  }
  state.releaseValues = mergeReleaseValues(values, stage, configuredIpv4);
  state.retainedState = readRetainedState(state.releaseValues);
  state.retainedSecretOutput = null;
  return successfulCommandResult('');
}

function mergeReleaseValues(values: KubernetesInstallSecretValues, stage: string, configuredIpv4: string): string {
  return JSON.stringify({
    ingress:
      values.ingress ??
      (configuredIpv4 === ''
        ? { className: 'traefik', endpoint: { type: '', value: '' } }
        : { className: 'traefik', endpoint: { type: 'A', value: configuredIpv4 } }),
    platform: {
      ...values.platform,
      publicProtocol: values.platform.publicProtocol ?? 'http',
      startupStage: stage,
      tlsMode: values.platform.tlsMode ?? 'issuer',
    },
    registry: values.registry,
    secrets: values.secrets,
  });
}

function stubManagedInstallFetch(events: string[], brokerRequests: RequestInit[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url: string = readFetchUrl(input);
      if (url.startsWith('https://broker.compartment.run')) {
        const binding: boolean = url.endsWith('/targets');
        events.push(binding ? 'broker:bind' : 'broker:allocate');
        brokerRequests.push(init ?? {});
        return await Promise.resolve(
          binding
            ? Response.json({
                allocationId: 'allocation-1',
                targets: [{ type: 'A', value: detectedPublicIpv4 }],
              })
            : Response.json({
                allocationId: 'allocation-1',
                baseDomain: 'acme.compartment.run',
                scopedToken: 'allocation-token',
              }),
        );
      }
      return await Promise.resolve(readyControlPlaneResponse());
    }),
  );
}

function readFetchUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function managedBrokerResponse(url: string): Response {
  return url.endsWith('/targets')
    ? Response.json({
        allocationId: 'allocation-1',
        targets: [{ type: 'A', value: detectedPublicIpv4 }],
      })
    : Response.json({
        allocationId: 'allocation-1',
        baseDomain: 'acme.compartment.run',
        scopedToken: 'allocation-token',
      });
}

function readBrokerRequest(requests: RequestInit[]): ManagedDomainReservationRequest {
  const request: RequestInit | undefined = requests[0];
  if (request === undefined || typeof request.body !== 'string') {
    throw new Error('Expected a JSON broker request body.');
  }
  return JSON.parse(request.body) as ManagedDomainReservationRequest;
}

function readBrokerRequestBody(request: RequestInit): ManagedDomainReservationRequest {
  if (typeof request.body !== 'string') {
    throw new Error('Expected a JSON broker request body.');
  }
  return JSON.parse(request.body) as ManagedDomainReservationRequest;
}

function readResolvedInstallValues(state: InstallHarnessState): KubernetesInstallSecretValues {
  const value: KubernetesInstallSecretValues | undefined = state.installValues.at(-1);
  if (value === undefined) {
    throw new Error('Expected rendered install values.');
  }
  return value;
}

function readHelmStages(): string[] {
  return mocks.runCommand.mock.calls
    .map((call: RunCommandCall): readonly string[] => call[0])
    .filter((command: readonly string[]): boolean => command[1] === 'upgrade')
    .map((command: readonly string[]): string => readLastOptionValue(command, '--set').split('=')[1]!);
}

function readCommandText(): string {
  return mocks.runCommand.mock.calls.flatMap((call: RunCommandCall): readonly string[] => call[0]).join('\n');
}

function readLastOptionValue(command: readonly string[], option: string): string {
  const optionIndex: number = command.lastIndexOf(option);
  const value: string | undefined = command[optionIndex + 1];
  if (optionIndex < 0 || value === undefined) {
    throw new Error(`Missing ${option} in command.`);
  }
  return value;
}

function readOptionValueFromEnd(command: readonly string[], option: string, occurrenceFromEnd: number): string {
  const optionIndexes: number[] = command.flatMap((value: string, index: number): number[] =>
    value === option ? [index] : [],
  );
  const optionIndex: number | undefined = optionIndexes.at(-occurrenceFromEnd);
  const value: string | undefined = optionIndex === undefined ? undefined : command[optionIndex + 1];
  if (value === undefined) {
    throw new Error(`Missing ${option} occurrence ${occurrenceFromEnd.toString()} from end in command.`);
  }
  return value;
}

function existingInstallValues(stage: 'foundation' | 'full', domainMode: 'custom' | 'managed'): string {
  return JSON.stringify({
    ingress: {
      className: 'traefik',
      endpoint: { type: 'A', value: detectedPublicIpv4 },
      targetsJson: JSON.stringify([{ type: 'A', value: detectedPublicIpv4 }]),
    },
    platform: {
      acmeEmail: 'admin@example.com',
      baseDomain: domainMode === 'managed' ? 'acme.compartment.run' : 'apps.example.com',
      domainMode,
      installationId: 'installation-123',
      managedDomainAllocationId: domainMode === 'managed' ? 'allocation-1' : '',
      managedDomainBrokerUrl: domainMode === 'managed' ? 'https://broker.compartment.run' : '',
      publicProtocol: 'https',
      startupStage: stage,
      tlsMode: domainMode === 'managed' ? 'broker-dns01' : 'issuer',
    },
    registry: {
      hostname: `registry.${domainMode === 'managed' ? 'acme.compartment.run' : 'apps.example.com'}`,
      issuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    },
    secrets: {
      installToken: 'existing-install-token',
      managedDomainBrokerToken: domainMode === 'managed' ? 'allocation-token' : '',
    },
  });
}

function legacyOperatorFoundationValues(): string {
  const values: KubernetesInstallSecretValues & { registry?: KubernetesInstallRegistryValues } = JSON.parse(
    existingInstallValues('foundation', 'custom'),
  ) as KubernetesInstallSecretValues;
  Reflect.deleteProperty(values, 'registry');
  return JSON.stringify(values);
}

function managedInstallValuesWithoutIngress(): string {
  const values: KubernetesInstallSecretValues = JSON.parse(
    existingInstallValues('foundation', 'managed'),
  ) as KubernetesInstallSecretValues;
  values.ingress = { className: 'traefik', endpoint: { type: '', value: '' }, targetsJson: '[]' };
  return JSON.stringify(values);
}

function existingLocalhostInstallValues(): string {
  return JSON.stringify({
    ingress: {
      className: 'traefik',
      endpoint: { type: '', value: '' },
      targetsJson: '[]',
    },
    platform: {
      acmeEmail: 'admin@example.com',
      baseDomain: 'compartment.localhost',
      domainMode: 'custom',
      installationId: 'installation-localhost',
      managedDomainBrokerUrl: '',
      publicProtocol: 'http',
      startupStage: 'full',
      tlsMode: 'issuer',
    },
    registry: {
      hostname: 'registry.compartment.localhost',
      issuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    },
    secrets: { installToken: 'existing-install-token', managedDomainBrokerToken: '' },
  });
}

function readRetainedState(releaseValues: string): KubernetesInstallState {
  const values: KubernetesInstallSecretValues & { platform: { startupStage?: string | undefined } } = JSON.parse(
    releaseValues,
  ) as KubernetesInstallSecretValues & { platform: { startupStage?: string | undefined } };
  return {
    acmeEmail: values.platform.acmeEmail,
    baseDomain: values.platform.baseDomain,
    brokerUrl: values.platform.managedDomainBrokerUrl,
    domainMode: values.platform.domainMode,
    installationId: values.platform.installationId,
    ingressClassName: values.ingress?.className ?? 'traefik',
    ingressEndpoint:
      values.ingress === undefined || values.ingress.endpoint.type === ''
        ? null
        : {
            type: values.ingress.endpoint.type,
            value: values.ingress.endpoint.value,
          },
    ingressTargets:
      values.ingress?.targetsJson === undefined
        ? []
        : (JSON.parse(values.ingress.targetsJson) as KubernetesIngressEndpoint[]),
    managedDomainAllocationId: values.platform.managedDomainAllocationId ?? '',
    managedDomainBrokerToken: values.secrets.managedDomainBrokerToken,
    publicProtocol: values.platform.publicProtocol ?? 'http',
    registryHostname: values.registry.hostname,
    registryIssuerRef: values.registry.issuerRef,
    tlsMode: values.platform.tlsMode ?? 'issuer',
  };
}
