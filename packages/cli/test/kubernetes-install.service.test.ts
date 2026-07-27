import { readFile, stat, writeFile } from 'node:fs/promises';
import type { ManagedDomainAllocationRequest } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { createCommandProgress } from '../src/commands/command.progress';
import { deployAndWaitForKubernetesInstall } from '../src/services/kubernetes-install.service';
import { runKubernetesHelmInstallStage } from '../src/services/kubernetes-install-helm.service';
import { waitForPublicControlPlane } from '../src/services/kubernetes-install-public.service';
import type { KubernetesInstallProgressReporter } from '../src/services/kubernetes-install-progress.types';
import { readRetainedKubernetesInstallState } from '../src/services/kubernetes-install-retained-state.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
  KubernetesInstallSecretValues,
  KubernetesInstallState,
} from '../src/services/kubernetes-install.service.types';
import type { CommandProgress } from '../src/commands/command.progress.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type RunCommandCall = [command: readonly string[]];
interface KubernetesInstallServiceMocks {
  runCommand: Mock<RunCommand>;
  verifyRegistryNodePull: Mock<(input: KubernetesInstallDeploymentInput) => Promise<void>>;
  writeVerifiedImages: Mock<(input: ImageTrustWriteInput) => Promise<void>>;
}

interface ImageTrustWriteInput {
  outputPath: string;
}

interface InstallHarnessState {
  events: string[];
  installValueModes: number[];
  installValuePaths: string[];
  installValues: KubernetesInstallSecretValues[];
  releaseValues: string | null;
  retainedState: KubernetesInstallState | null;
}

const mocks: KubernetesInstallServiceMocks = vi.hoisted(
  (): KubernetesInstallServiceMocks => ({
    runCommand: vi.fn<RunCommand>(),
    verifyRegistryNodePull: vi.fn(async (): Promise<void> => await Promise.resolve()),
    writeVerifiedImages: vi.fn(async (input: ImageTrustWriteInput): Promise<void> => {
      await writeFile(input.outputPath, JSON.stringify({ images: {} }), { mode: 0o600 });
    }),
  }),
);
const detectedPublicIpv4: string = [8, 8, 8, 8].join('.');
const configuredPublicIpv4: string = [8, 8, 4, 4].join('.');

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

const managedDeploymentInput: KubernetesInstallDeploymentInput = {
  acmeEmail: 'admin@example.com',
  brokerUrl: 'https://broker.compartment.run',
  chartPath: '/tmp/compartment-chart',
  domainMode: 'managed',
  managedDomainRequestedLabelSource: 'Acme Dev',
  namespace: 'compartment',
  releaseName: 'compartment',
  valuesPath: '/tmp/compartment-values.yaml',
};

describe('Kubernetes install deployment', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
    mocks.verifyRegistryNodePull.mockClear();
    mocks.writeVerifiedImages.mockClear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('allocates a managed domain from the LoadBalancer address before the final Helm render', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const brokerRequests: RequestInit[] = [];
    stubManagedInstallFetch(state.events, brokerRequests);

    const result: KubernetesInstallDeploymentResult = await deployAndWaitForKubernetesInstall(managedDeploymentInput);

    expect(result).toMatchObject({
      apiUrl: 'http://console.acme.compartment.run',
      baseDomain: 'acme.compartment.run',
    });
    expect(result.installToken).toMatch(/^[\da-f]{64}$/u);
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.events).toEqual([
      'helm:foundation',
      'kubectl:ingress',
      'broker:allocate',
      'helm:foundation',
      'helm:full',
    ]);
    const brokerRequest: ManagedDomainAllocationRequest = readBrokerRequest(brokerRequests);
    expect(brokerRequest).toMatchObject({
      publicIp: detectedPublicIpv4,
      requestedLabelSource: 'Acme Dev',
    });
    expect(brokerRequest.installationId).not.toBe('');
    expect(readResolvedInstallValues(state)).toMatchObject({
      platform: {
        baseDomain: 'acme.compartment.run',
        publicIngressIpv4: detectedPublicIpv4,
        publicIngressIpv6: '',
        publicProtocol: 'http',
        tlsMode: 'managed',
      },
      secrets: { managedDomainBrokerToken: 'acme-token' },
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
          brokerAttempt += 1;
          if (brokerAttempt < 3) {
            return await Promise.resolve(new Response('', { status: 502 }));
          }
          return await Promise.resolve(
            Response.json({ acmeDnsToken: 'acme-token', baseDomain: 'acme.compartment.run', dnsRecords: [] }),
          );
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
    expect(brokerRequests).toHaveLength(3);
    expect(brokerRequests.map(readBrokerRequestBody)).toEqual([
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
        brokerAttempt += 1;
        if (brokerAttempt === 1) {
          throw createFetchConnectionError('ECONNRESET');
        }
        return await Promise.resolve(
          Response.json({ acmeDnsToken: 'acme-token', baseDomain: 'acme.compartment.run', dnsRecords: [] }),
        );
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
    expect(brokerRequests.map(readBrokerRequestBody)).toEqual([
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
        brokerAttempt += 1;
        return await Promise.resolve(
          brokerAttempt === 1
            ? new Response('', { status: 429 })
            : Response.json({ acmeDnsToken: 'acme-token', baseDomain: 'acme.compartment.run', dnsRecords: [] }),
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
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains failed with status 502 (request-id: req_retry_123); transient failure after 4 attempts. Re-run install to resume.',
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
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains failed with status 400 (request-id: req_invalid_123). Check the install configuration before re-running install.',
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
      expect.stringMatching(/^Saving installation configuration.* \u2713 /u),
      expect.stringMatching(/^Waiting for platform pods \(api, worker, caddy\).* \u2713 /u),
      expect.stringMatching(/^Verifying private registry pull on every node.* \u2713 /u),
      expect.stringMatching(/^Issuing TLS certificate \(ACME\).* \u2713 /u),
    ]);
    expect(readCliStderr(capture)).not.toContain('\u001B');
  });

  it('does not complete when the every-node registry pull gate fails', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    stubManagedInstallFetch(state.events, []);
    mocks.verifyRegistryNodePull.mockRejectedValueOnce(new Error('node pull failed'));

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow('node pull failed');
    expect(mocks.verifyRegistryNodePull).toHaveBeenCalledOnce();
  });

  it('resumes persisted managed allocation state without calling the broker again', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(existingInstallValues('foundation', 'managed'));
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const fetchMock: Mock<(url: string) => Promise<Response>> = vi.fn(async (url: string): Promise<Response> => {
      if (url.startsWith('https://broker.compartment.run')) {
        throw new Error('broker must not be called');
      }
      return await Promise.resolve(readyControlPlaneResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.events).toEqual(['helm:foundation', 'helm:foundation', 'helm:full']);
  });

  it('reuses retained allocation state after the Helm release was removed', async (): Promise<void> => {
    const retainedState: KubernetesInstallState = readRetainedState(existingInstallValues('full', 'managed'));
    const state: InstallHarnessState = createInstallHarnessState(null, retainedState);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        if (readFetchUrl(input).startsWith('https://broker.compartment.run')) {
          throw new Error('broker must not be called');
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
          throw new Error('broker must not be called');
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
          throw new Error('broker must not be called');
        }
        return await Promise.resolve(readyControlPlaneResponse());
      }),
    );

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
    });
    expect(state.events).toEqual(['helm:foundation', 'kubectl:ingress', 'helm:foundation', 'helm:full']);
    expect(readResolvedInstallValues(state)).toMatchObject({
      ingress: { endpoint: { type: 'A', value: detectedPublicIpv4 } },
      platform: { publicIngressIpv4: detectedPublicIpv4 },
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
  });

  it('adopts a Kubernetes release created before retained install state existed', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(legacyCustomInstallValues('full'), null);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse())),
    );
    const progressEvents: string[] = [];
    const customInput: KubernetesInstallDeploymentInput = {
      ...managedDeploymentInput,
      apiUrl: 'https://console.apps.example.com',
      baseDomain: 'apps.example.com',
      brokerUrl: undefined,
      domainMode: 'custom',
      managedDomainRequestedLabelSource: undefined,
      progress: new RecordingProgressReporter(progressEvents),
    };

    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toEqual({
      apiUrl: 'https://console.apps.example.com',
      baseDomain: 'apps.example.com',
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual(['full']);
    expect(readResolvedInstallValues(state).platform.installationId).toMatch(/^[\da-f-]{36}$/u);
    expect(state.retainedState?.baseDomain).toBe('apps.example.com');
    expect(progressEvents).toContainEqual(expect.stringMatching(/^Preparing Helm chart and verifying images/u));
    expect(progressEvents).toContainEqual(expect.stringMatching(/^Waiting for platform pods \(api, worker, caddy\)/u));
  });

  it('materializes resumable state for a legacy foundation release', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(legacyCustomInstallValues('foundation'), null);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
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
    };

    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toMatchObject({
      baseDomain: 'apps.example.com',
    });
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.installValues[0]?.platform.installationId).toMatch(/^[\da-f-]{36}$/u);
    expect(readResolvedInstallValues(state).platform.installationId).toBe(
      state.installValues[0]?.platform.installationId,
    );
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

  it('preserves an explicit custom-domain ingress address without broker allocation', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
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
    };

    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toMatchObject({
      baseDomain: 'apps.example.com',
    });
    expect(state.events).toEqual(['helm:foundation', 'helm:foundation', 'helm:full']);
    expect(readResolvedInstallValues(state).platform.publicIngressIpv4).toBe(configuredPublicIpv4);
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
        .map((request: ManagedDomainAllocationRequest): string => request.installationId),
    ).toEqual([retainedInstallationId, retainedInstallationId]);
    expect(state.retainedState).toMatchObject({
      baseDomain: 'acme.compartment.run',
      managedDomainBrokerToken: 'acme-token',
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
      managedDomainBrokerToken: 'acme-token',
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
        return successfulCommandResult(retainedInstallStateSecretList(state.retainedState));
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
      publicIngressIpv4: values.platform.publicIngressIpv4 ?? configuredIpv4,
      publicIngressIpv6: values.platform.publicIngressIpv6 ?? '',
      publicProtocol: values.platform.publicProtocol ?? 'http',
      startupStage: stage,
      tlsMode: values.platform.tlsMode ?? 'custom-http',
    },
    secrets: values.secrets,
  });
}

function stubManagedInstallFetch(events: string[], brokerRequests: RequestInit[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url: string = readFetchUrl(input);
      if (url.startsWith('https://broker.compartment.run')) {
        events.push('broker:allocate');
        brokerRequests.push(init ?? {});
        return await Promise.resolve(
          Response.json({ acmeDnsToken: 'acme-token', baseDomain: 'acme.compartment.run', dnsRecords: [] }),
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

function readBrokerRequest(requests: RequestInit[]): ManagedDomainAllocationRequest {
  const request: RequestInit | undefined = requests[0];
  if (request === undefined || typeof request.body !== 'string') {
    throw new Error('Expected a JSON broker request body.');
  }
  return JSON.parse(request.body) as ManagedDomainAllocationRequest;
}

function readBrokerRequestBody(request: RequestInit): ManagedDomainAllocationRequest {
  if (typeof request.body !== 'string') {
    throw new Error('Expected a JSON broker request body.');
  }
  return JSON.parse(request.body) as ManagedDomainAllocationRequest;
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
    },
    platform: {
      acmeEmail: 'admin@example.com',
      baseDomain: domainMode === 'managed' ? 'acme.compartment.run' : 'apps.example.com',
      domainMode,
      installationId: 'installation-123',
      managedDomainBrokerUrl: domainMode === 'managed' ? 'https://broker.compartment.run' : '',
      publicIngressIpv4: detectedPublicIpv4,
      publicIngressIpv6: '',
      publicProtocol: 'https',
      startupStage: stage,
      tlsMode: domainMode === 'managed' ? 'managed' : 'custom-http',
    },
    secrets: {
      installToken: 'existing-install-token',
      managedDomainBrokerToken: domainMode === 'managed' ? 'acme-token' : '',
    },
  });
}

function managedInstallValuesWithoutIngress(): string {
  const values: KubernetesInstallSecretValues = JSON.parse(
    existingInstallValues('foundation', 'managed'),
  ) as KubernetesInstallSecretValues;
  values.platform.publicIngressIpv4 = '';
  values.platform.publicIngressIpv6 = '';
  values.ingress = { className: 'traefik', endpoint: { type: '', value: '' } };
  return JSON.stringify(values);
}

function legacyCustomInstallValues(stage: 'foundation' | 'full'): string {
  return JSON.stringify({
    ingress: {
      className: 'traefik',
      endpoint: { type: 'A', value: detectedPublicIpv4 },
    },
    platform: {
      acmeEmail: '',
      baseDomain: 'apps.example.com',
      publicIngressIpv4: detectedPublicIpv4,
      publicIngressIpv6: '',
      publicProtocol: 'https',
      startupStage: stage,
      tlsMode: 'custom-http',
    },
    secrets: { installToken: 'existing-install-token' },
  });
}

function existingLocalhostInstallValues(): string {
  return JSON.stringify({
    ingress: {
      className: 'traefik',
      endpoint: { type: '', value: '' },
    },
    platform: {
      acmeEmail: 'admin@example.com',
      baseDomain: 'compartment.localhost',
      domainMode: 'custom',
      installationId: 'installation-localhost',
      managedDomainBrokerUrl: '',
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      publicProtocol: 'http',
      startupStage: 'full',
      tlsMode: 'custom-http',
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
    managedDomainBrokerToken: values.secrets.managedDomainBrokerToken,
    publicIngressIpv4: values.platform.publicIngressIpv4 ?? '',
    publicIngressIpv6: values.platform.publicIngressIpv6 ?? '',
    publicProtocol: values.platform.publicProtocol ?? 'http',
    tlsMode: values.platform.tlsMode ?? 'custom-http',
  };
}

function retainedInstallStateSecretList(state: KubernetesInstallState | null): string {
  if (state === null) {
    return JSON.stringify({ items: [] });
  }
  return JSON.stringify({
    items: [
      {
        data: {
          'acme-email': encodeSecretValue(state.acmeEmail),
          'base-domain': encodeSecretValue(state.baseDomain),
          'domain-mode': encodeSecretValue(state.domainMode),
          'installation-id': encodeSecretValue(state.installationId),
          'ingress-class-name': encodeSecretValue(state.ingressClassName),
          'ingress-endpoint-type': encodeSecretValue(state.ingressEndpoint?.type ?? ''),
          'ingress-endpoint-value': encodeSecretValue(state.ingressEndpoint?.value ?? ''),
          'managed-domain-broker-token': encodeSecretValue(state.managedDomainBrokerToken),
          'managed-domain-broker-url': encodeSecretValue(state.brokerUrl),
          'public-ingress-ipv4': encodeSecretValue(state.publicIngressIpv4),
          'public-ingress-ipv6': encodeSecretValue(state.publicIngressIpv6),
          'public-protocol': encodeSecretValue(state.publicProtocol),
          'tls-mode': encodeSecretValue(state.tlsMode),
        },
      },
    ],
  });
}

function encodeSecretValue(value: string): string {
  return Buffer.from(value).toString('base64');
}

function ingressAddressList(addresses: readonly string[]): string {
  return JSON.stringify({
    items: [
      {
        status: { loadBalancer: { ingress: addresses.map((ip: string): { ip: string } => ({ ip })) } },
      },
    ],
  });
}

function helmReleaseList(status: string): string {
  return JSON.stringify([{ name: 'compartment', status }]);
}

function deployedReleaseList(): string {
  return helmReleaseList('deployed');
}

function readyControlPlaneResponse(): Response {
  return new Response(null, { headers: { location: '/login' }, status: 302 });
}

function successfulCommandResult(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

function createFetchConnectionError(code: string): Error {
  const error: Error = new TypeError('fetch failed');
  (error as Error & { cause?: { code?: string | undefined } | undefined }).cause = { code };
  return error;
}

class RecordingProgressReporter implements KubernetesInstallProgressReporter {
  public constructor(private readonly events: string[]) {}
  public report(message: string): void {
    this.events.push(message);
  }
}
