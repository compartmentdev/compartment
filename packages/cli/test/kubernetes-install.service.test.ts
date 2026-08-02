import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { ManagedDomainAllocationRequest } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { createCommandProgress } from '../src/commands/command.progress';
import { deployAndWaitForKubernetesInstall } from '../src/services/kubernetes-install.service';
import { runKubernetesHelmInstallStage } from '../src/services/kubernetes-install-helm.service';
import { buildResolvedInstallValues } from '../src/services/kubernetes-install-state.service';
import { readRetainedKubernetesInstallState } from '../src/services/kubernetes-install-retained-state.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
  KubernetesInstallSecretValues,
  KubernetesInstallState,
  KubernetesIngressEndpoint,
} from '../src/services/kubernetes-install.service.types';
import type { CommandProgress } from '../src/commands/command.progress.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';
import {
  createFetchConnectionError,
  deployedReleaseList,
  existingInstallValues,
  existingInstallValuesWithStorage,
  existingLocalhostInstallValues,
  helmReleaseList,
  type ImageTrustWriteInput,
  type InstallHarnessState,
  type KubernetesInstallServiceMocks,
  ingressAddressList,
  legacyOperatorFoundationValues,
  managedInstallValuesWithoutIngress,
  readyControlPlaneResponse,
  RecordingProgressReporter,
  retainedInstallStateSecretList,
  type RunCommandCall,
  successfulCommandResult,
} from './kubernetes-install.service.test-support';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type ReadChartValues = (chartPath: string) => Promise<JsonValue>;
const mocks: KubernetesInstallServiceMocks = vi.hoisted(
  (): KubernetesInstallServiceMocks => ({
    readChartValues: vi.fn<ReadChartValues>().mockResolvedValue({}),
    readRegistryServiceAddresses: vi.fn(async (): Promise<string[]> => await Promise.resolve([])),
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
const registryClusterIp: string = [10, 43, 250, 250].join('.');
let operatorValuesDirectory: string;

vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
  runCommandWithTimeout: mocks.runCommand,
}));
vi.mock('../src/services/kubernetes-chart-values.service', (): object => ({
  readKubernetesChartValues: mocks.readChartValues,
}));
vi.mock('../src/services/kubernetes-image-trust.service', (): object => ({
  writeVerifiedKubernetesInstallImageValues: mocks.writeVerifiedImages,
}));
vi.mock('../src/services/kubernetes-install-registry-verification.service', (): object => ({
  verifyKubernetesInstallRegistryNodePull: mocks.verifyRegistryNodePull,
}));
vi.mock('../src/services/kubernetes-install-registry-service.service', (): object => ({
  readRegistryServiceAddresses: mocks.readRegistryServiceAddresses,
}));
vi.mock('../src/services/kubernetes-install-tls.service', (): object => ({
  usesOperatorOwnedKubernetesTlsSecret: mocks.usesOperatorTlsSecret,
}));

const managedDeploymentInput: KubernetesInstallDeploymentInput = {
  acmeEmail: 'admin@example.com',
  brokerUrl: 'https://broker.compartment.run',
  chartPath: '/tmp/compartment-chart',
  clearConfiguredIngressEndpoint: false,
  configuredIngressEndpoint: null,
  domainMode: 'managed',
  ingressClassName: 'traefik',
  managedDomainRequestedLabelSource: 'Acme Dev',
  namespace: 'compartment',
  registryHostname: '',
  registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
  releaseName: 'compartment',
  valuesPath: '/tmp/compartment-values.yaml',
};

describe('Kubernetes install deployment', (): void => {
  beforeAll(async (): Promise<void> => {
    operatorValuesDirectory = await mkdtemp(resolve(tmpdir(), 'compartment-resume-values-test-'));
    managedDeploymentInput.valuesPath = resolve(operatorValuesDirectory, 'values.yaml');
    await writeFile(managedDeploymentInput.valuesPath, '{}');
  });

  afterAll(async (): Promise<void> => {
    await rm(operatorValuesDirectory, { force: true, recursive: true });
  });

  beforeEach((): void => {
    mocks.runCommand.mockReset();
    mocks.readChartValues.mockReset().mockResolvedValue({});
    mocks.readRegistryServiceAddresses.mockReset().mockResolvedValue([registryClusterIp]);
    mocks.verifyRegistryNodePull.mockReset().mockResolvedValue(undefined);
    mocks.usesOperatorTlsSecret.mockReset().mockResolvedValue(false);
    mocks.writeVerifiedImages.mockReset().mockImplementation(async (input: ImageTrustWriteInput): Promise<void> => {
      await writeFile(input.outputPath, JSON.stringify({ images: {} }), { mode: 0o600 });
    });
  });

  afterEach((): void => {
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
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.events).toEqual([
      'helm:foundation',
      'kubectl:ingress',
      'broker:allocate',
      'helm:foundation',
      'helm:full',
      'kubectl:certificate',
    ]);
    const brokerRequest: ManagedDomainAllocationRequest = readBrokerRequestBody(brokerRequests[0]!);
    expect(brokerRequest).toMatchObject({ publicIp: detectedPublicIpv4, requestedLabelSource: 'Acme Dev' });
    expect(brokerRequests).toHaveLength(1);
    expect(new Headers(brokerRequests[0]!.headers).get('Authorization')).toBeNull();
    expect(readResolvedInstallValues(state)).toMatchObject({
      platform: {
        baseDomain: 'acme.compartment.run',
        publicProtocol: 'https',
        tlsMode: 'broker-dns01',
      },
      secrets: { managedDomainAcmeDnsToken: 'acme-dns-token' },
    });
    expect(state.installValueModes).toEqual([0o600, 0o600, 0o600]);
    expect(readCommandText()).not.toContain(result.installToken);
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
          return await Promise.resolve(managedBrokerResponse());
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
        brokerAttempt += 1;
        if (brokerAttempt === 1) {
          throw createFetchConnectionError('ECONNRESET');
        }
        return await Promise.resolve(managedBrokerResponse());
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
        brokerAttempt += 1;
        return await Promise.resolve(brokerAttempt === 1 ? new Response('', { status: 429 }) : managedBrokerResponse());
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
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains failed with status 502 (request-id: req_retry_123); transient failure after 4 attempts while attempting to allocate managed domain. Re-run install to resume.',
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

    const expectedMessage: string =
      'Managed-domain broker POST https://broker.compartment.run/v1/managed-domains failed with status 400 (request-id: req_invalid_123) while attempting to allocate managed domain. Check the install configuration before re-running install.';
    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toSatisfy(
      (error: Error): boolean => error.message === expectedMessage && !error.message.includes('--init-install'),
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
        return await Promise.resolve(managedBrokerResponse());
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
    const customInput: KubernetesInstallDeploymentInput = customDeploymentInput();

    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toMatchObject({
      baseDomain: 'apps.example.com',
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.installValues[0]).toMatchObject({
      platform: { installationId: 'installation-123' },
      registry: {
        hostname: '',
        issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      },
      secrets: { installToken: 'existing-install-token' },
    });
    expect(state.retainedState).toMatchObject({
      registryHostname: registryClusterIp,
      registryIssuerRef: { kind: 'Issuer', name: 'compartment-platform' },
    });
    expect(state.retainedState?.registryHostname).not.toContain('apps.example.com');
  });

  it('reuses retained allocation state after the Helm release was removed', async (): Promise<void> => {
    const retainedState: KubernetesInstallState = readRetainedState(existingInstallValues('full', 'managed'));
    retainedState.brokerUrl = '';
    const state: InstallHarnessState = createInstallHarnessState(null, retainedState);
    const reinstalledRegistryClusterIp: string = [10, 43, 199, 7].join('.');
    mocks.readRegistryServiceAddresses.mockResolvedValue([reinstalledRegistryClusterIp]);
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        if (readFetchUrl(input).startsWith('https://broker.compartment.run')) {
          return await Promise.resolve(managedBrokerResponse());
        }
        return await Promise.resolve(readyControlPlaneResponse());
      }),
    );

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
    });
    expect(state.installValues[0]?.platform.managedDomainBrokerUrl).toBe('https://broker.compartment.run');
    expect(readResolvedInstallValues(state).platform.managedDomainBrokerUrl).toBe('https://broker.compartment.run');
    expect(readResolvedInstallValues(state).registry.hostname).toBe(reinstalledRegistryClusterIp);
    expect(readResolvedInstallValues(state).registry.hostname).not.toContain(retainedState.baseDomain);
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
          return await Promise.resolve(managedBrokerResponse());
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
          return await Promise.resolve(managedBrokerResponse());
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

  it('migrates a legacy full release to the current registry Service address before owner bootstrap', async (): Promise<void> => {
    mocks.readChartValues.mockResolvedValue({ secrets: { tenantSecretsPreviousKek: null } });
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
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.events).toEqual(['helm:foundation', 'helm:foundation', 'helm:full', 'kubectl:certificate']);
    expect(readResolvedInstallValues(state).registry.hostname).toBe(registryClusterIp);
  });
  it('reconciles changed operator certificate sources before resuming a full release', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(existingInstallValues('full', 'custom'));
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, configuredPublicIpv4));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse())),
    );
    const valuesPath: string = resolve(operatorValuesDirectory, 'changed-values.yaml');
    await writeFile(
      valuesPath,
      `ingress:\n  className: nginx\n  endpoint:\n    type: A\n    value: ${configuredPublicIpv4}\nregistry:\n  issuerRef:\n    kind: ClusterIssuer\n    name: letsencrypt-production\n`,
    );
    const progressEvents: string[] = [];
    const customInput: KubernetesInstallDeploymentInput = customDeploymentInput({
      progress: new RecordingProgressReporter(progressEvents),
      configuredIngressEndpoint: { type: 'A', value: configuredPublicIpv4 },
      ingressClassName: 'nginx',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'letsencrypt-production' },
      valuesPath,
    });
    await expect(deployAndWaitForKubernetesInstall(customInput)).resolves.toMatchObject({
      baseDomain: 'apps.example.com',
      installToken: 'existing-install-token',
    });
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(state.installValues[0]?.registry.issuerRef).toMatchObject({
      kind: 'ClusterIssuer',
      name: 'letsencrypt-production',
    });
    expect(state.installValues[0]?.ingress?.className).toBe('nginx');
    expect(state.installValues[0]?.ingress?.endpoint.value).toBe(configuredPublicIpv4);
    expect(progressEvents).toContain(
      'Reconciling changed Helm values: ingress.className, ingress.endpoint.value, ingress.targetsJson, registry.hostname, registry.issuerRef.kind, registry.issuerRef.name',
    );
  });
  it('reconciles a removed managed override without reserving another domain', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState(
      existingInstallValuesWithStorage('full', 'managed', 'legacy-storage', { type: 'A', value: configuredPublicIpv4 }),
    );
    mocks.readChartValues.mockResolvedValue({ storage: { storageClass: '' } });
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state));
    const brokerUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url: string = readFetchUrl(input);
        brokerUrls.push(url);
        return await Promise.resolve(
          url.startsWith('https://broker.compartment.run') ? managedBrokerResponse() : readyControlPlaneResponse(),
        );
      }),
    );
    const progressEvents: string[] = [];

    await deployAndWaitForKubernetesInstall({
      ...managedDeploymentInput,
      clearConfiguredIngressEndpoint: true,
      progress: new RecordingProgressReporter(progressEvents),
    });

    expect(progressEvents).toContain(
      'Reconciling changed Helm values: ingress.endpoint.value, ingress.targetsJson, registry.hostname, storage.storageClass',
    );
    expect(readHelmStages()).toEqual(['foundation', 'foundation', 'full']);
    expect(brokerUrls.some((url: string): boolean => url.startsWith('https://broker.compartment.run'))).toBe(false);
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
    const customInput: KubernetesInstallDeploymentInput = customDeploymentInput({
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'customer-platform' },
    });

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
    const customInput: KubernetesInstallDeploymentInput = customDeploymentInput({
      apiUrl: undefined,
      baseDomain: 'compartment.localhost',
    });

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
    const customInput: KubernetesInstallDeploymentInput = customDeploymentInput({
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'customer-platform' },
    });

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
        hostname: registryClusterIp,
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
    expect(state.retainedState).toMatchObject({ baseDomain: '', managedDomainAcmeDnsToken: '' });

    await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).resolves.toMatchObject({
      baseDomain: 'acme.compartment.run',
    });
    expect(
      brokerRequests
        .map(readBrokerRequestBody)
        .filter((request: ManagedDomainAllocationRequest): boolean => 'installationId' in request)
        .map((request: ManagedDomainAllocationRequest): string => request.installationId),
    ).toEqual([retainedInstallationId, retainedInstallationId]);
    expect(state.retainedState).toMatchObject({
      baseDomain: 'acme.compartment.run',
      managedDomainAcmeDnsToken: 'acme-dns-token',
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

  it('rejects a hostname Ingress endpoint before broker allocation without resolving it to an IP', async (): Promise<void> => {
    const state: InstallHarnessState = createInstallHarnessState();
    mocks.runCommand.mockImplementation(createInstallCommandHandler(state, 'shared-lb.example.com'));
    const fetchMock: Mock<(input: string | URL | Request) => Promise<Response>> = vi.fn(
      async (): Promise<Response> => await Promise.resolve(readyControlPlaneResponse()),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deployAndWaitForKubernetesInstall({
        ...managedDeploymentInput,
        configuredIngressEndpoint: { type: 'hostname', value: 'shared-lb.example.com' },
      }),
    ).rejects.toThrow(
      'Managed domains are unavailable for a hostname Ingress endpoint because the broker can publish only A/AAAA records to an IP address. Use your own domain with --base-domain instead',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.events).toEqual([]);
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
      managedDomainAcmeDnsToken: 'acme-dns-token',
    });
  });

  it.each(['failed', 'pending-upgrade', 'uninstalled'])(
    'rejects a Helm release with status %s',
    async (status: string): Promise<void> => {
      mocks.runCommand.mockResolvedValueOnce(successfulCommandResult(helmReleaseList(status))).mockResolvedValueOnce(
        successfulCommandResult(
          JSON.stringify([
            { revision: 3, status: 'superseded' },
            { revision: 4, status },
          ]),
        ),
      );
      await expect(deployAndWaitForKubernetesInstall(managedDeploymentInput)).rejects.toThrow(
        `existing Helm release compartment has status ${status}. Restore it with \`helm rollback compartment 3 --namespace compartment --wait --timeout 8m --force-conflicts\``,
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
      'Non-Ready pods: compartment-api-123 (Pending). Check with `kubectl get pods -n compartment`. The installation remains incomplete. Inspect it with `helm status compartment --namespace compartment`, then re-run compartment install to resume.',
    );
    expect(mocks.runCommand.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(['--timeout', '8m']));
    expect(mocks.runCommand.mock.calls[0]?.[0]).toContain('--force-conflicts');
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
      'Failed to inspect retained Kubernetes install state (command exited with status 1): Error from server (Forbidden)',
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

function customDeploymentInput(
  overrides: Partial<KubernetesInstallDeploymentInput> = {},
): KubernetesInstallDeploymentInput {
  return {
    ...managedDeploymentInput,
    apiUrl: 'https://console.apps.example.com',
    baseDomain: 'apps.example.com',
    brokerUrl: undefined,
    domainMode: 'custom',
    managedDomainRequestedLabelSource: undefined,
    registryHostname: '',
    ...overrides,
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
        events.push('broker:allocate');
        brokerRequests.push(init ?? {});
        return await Promise.resolve(
          Response.json({
            acmeDnsToken: 'acme-dns-token',
            baseDomain: 'acme.compartment.run',
            dnsRecords: [{ host: '*.acme.compartment.run', purpose: 'Managed ingress', type: 'A/AAAA-or-CNAME' }],
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

function managedBrokerResponse(): Response {
  return Response.json({
    acmeDnsToken: 'acme-dns-token',
    baseDomain: 'acme.compartment.run',
    dnsRecords: [{ host: '*.acme.compartment.run', purpose: 'Managed ingress', type: 'A/AAAA-or-CNAME' }],
  });
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
    managedDomainAcmeDnsToken: values.secrets.managedDomainAcmeDnsToken,
    publicProtocol: values.platform.publicProtocol ?? 'http',
    registryHostname: values.registry.hostname,
    registryIssuerRef: values.registry.issuerRef,
    tlsMode: values.platform.tlsMode ?? 'issuer',
  };
}
