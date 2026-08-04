import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommand, runCommandWithInput } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import { assertRetainedIdentity } from '../src/services/kubernetes-existing-cluster-preflight.resources';
import { runKubernetesExistingClusterPreflight } from '../src/services/kubernetes-existing-cluster-preflight.service';
import type { KubernetesExistingClusterPreflightInput } from '../src/services/kubernetes-existing-cluster-preflight.service.types';

vi.mock('../src/command-runner', (): object => ({
  runCommand: vi.fn(),
  runCommandWithInput: vi.fn(),
}));

const mockedRunCommand: MockedFunction<typeof runCommand> = vi.mocked(runCommand);
const mockedRunCommandWithInput: MockedFunction<typeof runCommandWithInput> = vi.mocked(runCommandWithInput);
const certManagerInstruction: string =
  'kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml';

interface PreflightFixture {
  clusterResources: Map<string, object>;
  deniedPermissions: Set<string>;
  deployments: object[];
  ingressClasses: object[];
  ingresses: object[];
  namespace: object | null;
  rawResources: Map<string, string[]>;
  retainedSecret: object | null;
  storageClasses: object[];
  version: string;
  webhookConfigurations: object[];
}

type CommandCall = [command: readonly string[], env?: NodeJS.ProcessEnv | undefined];
type CommandWithInputCall = [command: readonly string[], input: string];

afterEach((): void => {
  vi.clearAllMocks();
});

describe('existing Kubernetes non-persistent preflight', (): void => {
  it.each([
    'not-an-email',
    '.operator@compartment.run',
    'operator@foo..com',
    'operator@-foo.com',
    'operator@foo_.com',
    'operator@example.com',
    'operator@localhost',
  ])('rejects invalid ACME admin email %s before contacting Kubernetes', async (email: string): Promise<void> => {
    const input: KubernetesExistingClusterPreflightInput = preflightInput();
    input.install.owner.email = email;

    await expect(runKubernetesExistingClusterPreflight(input)).rejects.toThrow('Admin email');
    expect(mockedRunCommand).not.toHaveBeenCalled();
    expect(mockedRunCommandWithInput).not.toHaveBeenCalled();
  });

  it('allows a .test admin email through preflight', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    installFixture(fixture);
    const input: KubernetesExistingClusterPreflightInput = preflightInput();
    input.install.owner.email = 'operator@service.test';

    await expect(runKubernetesExistingClusterPreflight(input)).resolves.toEqual({
      kubernetesVersion: 'v1.33.2',
    });
  });

  it('does not expose a partial retained identity Secret in preflight failures', async (): Promise<void> => {
    const encodedSecret: string = Buffer.from('install-token').toString('base64');
    mockedRunCommand.mockResolvedValue({
      exitCode: 1,
      stderr: 'Error from server (Forbidden)',
      stdout: JSON.stringify({ data: { 'install-token': encodedSecret } }),
    });

    const inspection: Promise<void> = assertRetainedIdentity(preflightInput().install);
    await expect(inspection).rejects.toThrow('Error from server (Forbidden)');
    await expect(inspection).rejects.not.toThrow(encodedSecret);
    await expect(inspection).rejects.not.toThrow('install-token');
  });

  it('reports the exact missing cert-manager API and pinned install instruction', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.rawResources.set('/apis/cert-manager.io/v1', ['certificaterequests', 'issuers', 'clusterissuers']);
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      /certificates at \/apis\/cert-manager\.io\/v1.*cert-manager\/releases\/download\/v1\.21\.0/su,
    );
  });

  it('rejects an unsupported Kubernetes version before later checks', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.version = 'v1.29.9';
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'Kubernetes 1.30 or newer is required; detected v1.29.9.',
    );
  });

  it('accepts a newer Kubernetes minor when all required capabilities are present', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.version = 'v1.40.0';
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).resolves.toEqual({
      kubernetesVersion: 'v1.40.0',
    });
  });

  it('reports a missing core API resource', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.rawResources.set('/api/v1', ['namespaces', 'secrets', 'services', 'serviceaccounts']);
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'Missing required api resources: configmaps at /api/v1',
    );
  });

  it('names an unready cert-manager webhook component', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.deployments = fixture.deployments.map((deployment: object): object =>
      JSON.stringify(deployment).includes('"webhook"') ? deploymentWithComponent('webhook', 0) : deployment,
    );
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      new RegExp(`cert-manager webhook is missing or not ready.*${escapeRegExp(certManagerInstruction)}`, 'su'),
    );
  });

  it.each(['controller', 'cainjector'] as const)(
    'rejects a scaled-to-zero cert-manager %s',
    async (component: 'cainjector' | 'controller'): Promise<void> => {
      const fixture: PreflightFixture = passingFixture();
      const deploymentIndex: number = component === 'controller' ? 0 : 2;
      fixture.deployments[deploymentIndex] = {
        ...deploymentWithComponent(component, 0),
        spec: { replicas: 0 },
      };
      installFixture(fixture);

      await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
        `cert-manager ${component} is missing or not ready.`,
      );
    },
  );

  it('requires exactly one registered cert-manager webhook Service', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.webhookConfigurations = [];
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'cert-manager webhook Service discovery found 0 matches',
    );
  });

  it('requires an explicit IngressClass when selection is ambiguous', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.ingressClasses = [named('nginx'), named('traefik')];
    installFixture(fixture);

    await expect(
      runKubernetesExistingClusterPreflight({
        ...preflightInput(),
        install: { ...preflightInput().install, ingressClass: '' },
      }),
    ).rejects.toThrow('IngressClass selection is ambiguous (nginx, traefik); choose one with --ingress-class.');
  });

  it('requires an explicit StorageClass without one unambiguous default', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.storageClasses = [named('fast'), named('durable')];
    installFixture(fixture);

    await expect(
      runKubernetesExistingClusterPreflight({
        ...preflightInput(),
        install: { ...preflightInput().install, storageClass: '' },
      }),
    ).rejects.toThrow('StorageClass selection is ambiguous (fast, durable); choose one with --storage-class.');
  });

  it('rejects explicitly selected classes that do not exist', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    installFixture(fixture);

    await expect(
      runKubernetesExistingClusterPreflight({
        ...preflightInput(),
        install: { ...preflightInput().install, ingressClass: 'missing' },
      }),
    ).rejects.toThrow('IngressClass "missing" does not exist.');
  });

  it('fails on an existing Ingress host before any mutating command', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.ingresses = [
      {
        metadata: { name: 'customer-console', namespace: 'customer' },
        spec: { rules: [{ host: 'console.apps.example.com' }] },
      },
    ];
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'Ingress host "console.apps.example.com" is already owned by customer/customer-console.',
    );
    expect(allKubectlCalls().every(isReadOnlyOrDryRunCommand)).toBe(true);
  });

  it('reports the exact missing permission list', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.deniedPermissions.add('* secrets');
    fixture.deniedPermissions.add('* clusterroles.rbac.authorization.k8s.io');
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'Missing Kubernetes permissions: * secrets in namespace compartment, * clusterroles.rbac.authorization.k8s.io cluster-wide.',
    );
  });

  it('rejects a namespace owned by another Helm release', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.namespace = {
      metadata: {
        annotations: {
          'meta.helm.sh/release-name': 'other',
          'meta.helm.sh/release-namespace': 'other',
        },
      },
    };
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'Namespace compartment is owned by Helm release other/other, not compartment/compartment.',
    );
  });

  it('rejects a retained installation identity owned by another release', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.retainedSecret = {
      metadata: {
        annotations: {
          'meta.helm.sh/release-name': 'other',
          'meta.helm.sh/release-namespace': 'other',
        },
        name: 'compartment-install-state',
      },
    };
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'Retained installation identity compartment-install-state is owned by Helm release other/other',
    );
  });

  it('rejects an exact cluster-scoped resource owned by another release', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    fixture.clusterResources.set('clusterroles.rbac.authorization.k8s.io/compartment-controller', {
      kind: 'ClusterRole',
      metadata: {
        annotations: {
          'meta.helm.sh/release-name': 'other',
          'meta.helm.sh/release-namespace': 'other',
        },
        name: 'compartment-controller',
      },
    });
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'ClusterRole compartment-controller is owned by Helm release other/other',
    );
  });

  it('uses only reads plus server-side dry-run and leaves no Certificate or Secret', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    installFixture(fixture);

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).resolves.toEqual({
      kubernetesVersion: 'v1.33.2',
    });
    expect(mockedRunCommandWithInput).toHaveBeenCalledTimes(1);
    expect(mockedRunCommandWithInput.mock.calls[0]?.[0]).toContain('--dry-run=server');
    const absenceCalls: readonly string[][] = mockedRunCommand.mock.calls
      .map((call: CommandCall): string[] => [...call[0]])
      .filter((command: string[]): boolean => command.includes('compartment-preflight-' + process.pid.toString()));
    expect(absenceCalls).toHaveLength(4);
    expect(absenceCalls.every((command: string[]): boolean => command.includes('get'))).toBe(true);
    expect(allKubectlCalls().every(isReadOnlyOrDryRunCommand)).toBe(true);
  });

  it('checks Certificate and Secret absence after a rejected dry-run', async (): Promise<void> => {
    const fixture: PreflightFixture = passingFixture();
    installFixture(fixture);
    mockedRunCommandWithInput.mockResolvedValue(failure('admission denied'));

    await expect(runKubernetesExistingClusterPreflight(preflightInput())).rejects.toThrow(
      'cert-manager webhook rejected the server-side Certificate dry-run: admission denied',
    );
    const absenceCalls: string[][] = mockedRunCommand.mock.calls
      .map((call: CommandCall): string[] => [...call[0]])
      .filter((command: string[]): boolean => command.includes(`compartment-preflight-${process.pid.toString()}`));
    expect(absenceCalls).toHaveLength(4);
  });
});

function installFixture(fixture: PreflightFixture): void {
  mockedRunCommand.mockImplementation(
    async (command: readonly string[]): Promise<CommandResult> => await Promise.resolve(routeCommand(fixture, command)),
  );
  mockedRunCommandWithInput.mockResolvedValue(success({ kind: 'Certificate' }));
}

function routeCommand(fixture: PreflightFixture, command: readonly string[]): CommandResult {
  const args: string = command.join(' ');
  return routeCoreCommand(fixture, command, args) ?? routeResourceCommand(fixture, args);
}

function routeCoreCommand(
  fixture: PreflightFixture,
  command: readonly string[],
  args: string,
): CommandResult | undefined {
  if (command[0] === 'cosign') {
    return success({});
  }
  if (args.includes(' version ')) {
    return success({ serverVersion: { gitVersion: fixture.version } });
  }
  const rawPath: string | undefined = command[command.indexOf('--raw') + 1];
  if (command.includes('--raw') && rawPath !== undefined) {
    const resources: string[] | undefined = fixture.rawResources.get(rawPath);
    return resources === undefined
      ? failure('NotFound')
      : success({ groupVersion: rawPath, resources: resources.map((name: string): object => ({ name })) });
  }
  if (args.includes(' auth can-i ')) {
    const canIIndex: number = command.indexOf('can-i');
    const key: string = `${command[canIIndex + 1] ?? ''} ${command[canIIndex + 2] ?? ''}`;
    return fixture.deniedPermissions.has(key) ? { exitCode: 0, stderr: '', stdout: 'no\n' } : textSuccess('yes\n');
  }
  return undefined;
}

function routeResourceCommand(fixture: PreflightFixture, args: string): CommandResult {
  if (args.includes(' get namespace ')) {
    return fixture.namespace === null ? failure('NotFound') : success(fixture.namespace);
  }
  const clusterResource: CommandResult | undefined = routeClusterResource(fixture, args);
  if (clusterResource !== undefined) {
    return clusterResource;
  }
  if (args.includes('ingressclasses.networking.k8s.io')) {
    return success({ items: fixture.ingressClasses });
  }
  if (args.includes('validatingwebhookconfigurations.admissionregistration.k8s.io')) {
    return success({ items: fixture.webhookConfigurations });
  }
  if (args.includes('deployments.apps')) {
    return success({ items: fixture.deployments });
  }
  if (args.includes('compartment-preflight-')) {
    return failure('NotFound');
  }
  if (args.includes('storageclasses.storage.k8s.io')) {
    return success({ items: fixture.storageClasses });
  }
  if (args.includes('ingresses.networking.k8s.io')) {
    return success({ items: fixture.ingresses });
  }
  if (args.includes(' get secret compartment-install-state ')) {
    return fixture.retainedSecret === null ? failure('NotFound') : success(fixture.retainedSecret);
  }
  throw new Error(`Unexpected command: ${args}`);
}

function routeClusterResource(fixture: PreflightFixture, args: string): CommandResult | undefined {
  for (const resource of [
    'clusterroles.rbac.authorization.k8s.io',
    'clusterrolebindings.rbac.authorization.k8s.io',
    'validatingadmissionpolicies.admissionregistration.k8s.io',
    'validatingadmissionpolicybindings.admissionregistration.k8s.io',
  ]) {
    const match: RegExpExecArray | null = new RegExp(` get ${resource} ([^ ]+) `, 'u').exec(args);
    if (match !== null) {
      const value: object | undefined = fixture.clusterResources.get(`${resource}/${match[1] ?? ''}`);
      return value === undefined ? failure('NotFound') : success(value);
    }
  }
  return undefined;
}

function passingFixture(): PreflightFixture {
  return {
    clusterResources: new Map(),
    deniedPermissions: new Set(),
    deployments: [
      deploymentWithComponent('controller', 1),
      deploymentWithComponent('webhook', 1),
      deploymentWithComponent('cainjector', 1),
    ],
    ingressClasses: [named('nginx')],
    ingresses: [],
    namespace: { metadata: {} },
    rawResources: new Map([
      [
        '/api/v1',
        [
          'configmaps',
          'namespaces',
          'nodes',
          'persistentvolumeclaims',
          'pods',
          'secrets',
          'services',
          'serviceaccounts',
        ],
      ],
      ['/apis/apps/v1', ['daemonsets', 'deployments', 'statefulsets']],
      ['/apis/batch/v1', ['cronjobs', 'jobs']],
      ['/apis/networking.k8s.io/v1', ['ingresses', 'ingressclasses', 'networkpolicies']],
      ['/apis/node.k8s.io/v1', ['runtimeclasses']],
      ['/apis/rbac.authorization.k8s.io/v1', ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings']],
      ['/apis/storage.k8s.io/v1', ['storageclasses']],
      ['/apis/admissionregistration.k8s.io/v1', ['validatingadmissionpolicies', 'validatingadmissionpolicybindings']],
      ['/apis/cert-manager.io/v1', ['certificates', 'certificaterequests', 'issuers', 'clusterissuers']],
      ['/apis/acme.cert-manager.io/v1', ['orders', 'challenges']],
    ]),
    retainedSecret: null,
    storageClasses: [
      {
        metadata: {
          annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' },
          name: 'fast',
        },
      },
    ],
    version: 'v1.33.2',
    webhookConfigurations: [
      {
        webhooks: [
          {
            clientConfig: {
              service: { name: 'cert-manager-webhook', namespace: 'cert-system' },
            },
          },
        ],
      },
    ],
  };
}

function preflightInput(): KubernetesExistingClusterPreflightInput {
  return {
    apiHosts: ['console.apps.example.com'],
    chartFullname: 'compartment',
    install: {
      clearIngressEndpoint: false,
      domain: { baseDomain: 'apps.example.com', mode: 'operator', publicProtocol: 'http' },
      ingressClass: 'nginx',
      kubeContext: 'production',
      kubeconfigPath: '/tmp/kubeconfig',
      namespace: 'compartment',
      owner: {
        email: 'owner@compartment.run',
        organizationName: 'Acme',
        password: 'correct horse battery staple',
      },
      releaseName: 'compartment',
      storageClass: 'fast',
      valuesPath: '/tmp/values.yaml',
    },
  };
}

function deploymentWithComponent(component: string, availableReplicas: number): object {
  return {
    metadata: {
      labels: {
        'app.kubernetes.io/component': component,
        'app.kubernetes.io/instance': 'platform-certificates',
      },
      name: component === 'webhook' ? 'cert-manager-webhook' : `cert-manager-${component}`,
      namespace: 'cert-system',
    },
    spec: { replicas: 1 },
    status: { availableReplicas },
  };
}

function named(name: string): object {
  return { metadata: { name } };
}

function success(value: object): CommandResult {
  return { exitCode: 0, stderr: '', stdout: JSON.stringify(value) };
}

function textSuccess(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

function failure(stderr: string): CommandResult {
  return { exitCode: 1, stderr, stdout: '' };
}

function allKubectlCalls(): string[][] {
  return [
    ...mockedRunCommand.mock.calls.map((call: CommandCall): string[] => [...call[0]]),
    ...mockedRunCommandWithInput.mock.calls.map((call: CommandWithInputCall): string[] => [...call[0]]),
  ].filter((command: string[]): boolean => command[0] === 'kubectl');
}

function isReadOnlyOrDryRunCommand(command: readonly string[]): boolean {
  return (
    command.includes('get') ||
    command.includes('version') ||
    command.includes('auth') ||
    command.includes('--dry-run=server')
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
