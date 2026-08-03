import { describe, expect, it, vi, type Mock } from 'vitest';
import { resolveCanonicalKubernetesInstallInput } from '../src/commands/install/install.command.input';
import { resolveCanonicalKubernetesInstallWizard } from '../src/commands/install/install.command.kubernetes-wizard';
import type {
  InstallCommandOptions,
  InstallWizardIssuerReference,
} from '../src/commands/install/install.command.types';
import type { KubernetesInstallInputValues } from '../src/commands/install/install.command.input.types';
import type {
  InspectKubernetesInstallIssuer,
  KubernetesInstallWizardResult,
  ReadKubernetesInstallResourceInventory,
} from '../src/commands/install/install.command.kubernetes-wizard.types';
import type { KubernetesInstallInput } from '../src/services/kubernetes-install-input.service.types';
import type { KubernetesInstallResourceInventory } from '../src/services/kubernetes-install-inventory.service.types';
import type { KubernetesOperatorIssuerAssessment } from '../src/services/kubernetes-operator-issuer-trust.service.types';
import type { RetainedKubernetesInstallState } from '../src/services/kubernetes-install.service.types';
import { createCliCapture, type CliCommandCapture } from './cli-test.harness';

const kubeconfigPath: string = '/tmp/kubeconfig';
const valuesPath: string = '/tmp/values.yaml';
const retainedIngressIp: string = [8, 8, 8, 8].join('.');
const retainedRegistryIp: string = [10, 43, 0, 10].join('.');
const inspectPublicAcme: InspectKubernetesInstallIssuer = async (): Promise<KubernetesOperatorIssuerAssessment> =>
  await Promise.resolve({ detail: 'Public ACME issuer.', trust: 'acme' });
const inspectPlatformAndRegistryIssuer: InspectKubernetesInstallIssuer = async (
  _contextName: string,
  _namespace: string,
  issuer: InstallWizardIssuerReference,
): Promise<KubernetesOperatorIssuerAssessment> =>
  issuer.name.includes('registry')
    ? await Promise.resolve({ detail: 'Registry CA issuer.', trust: 'ca' })
    : await Promise.resolve({ detail: 'Public ACME issuer.', trust: 'acme' });

describe('canonical Kubernetes install input', (): void => {
  it('produces the same validated input from interactive answers and flags', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\n\nClusterIssuer\nregistry-ca\ny\nowner@example.com\nAcme\ny\n');
    const options: InstallCommandOptions = {
      adminPassword: 'correct horse battery staple',
      output: 'text',
    };
    const wizard: KubernetesInstallWizardResult = await resolveCanonicalKubernetesInstallWizard(
      capture.io,
      options,
      { contexts: [{ apiServer: 'https://cluster.example.test:6443', name: 'production' }] },
      async (): Promise<{ ingressClasses: string[]; storageClasses: { default: boolean; name: string }[] }> =>
        await Promise.resolve({
          ingressClasses: ['nginx'],
          storageClasses: [{ default: true, name: 'fast' }],
        }),
      inspectPlatformAndRegistryIssuer,
    );
    const interactive: KubernetesInstallInput = resolveCanonicalKubernetesInstallInput(
      { ...wizard.input, valuesPath },
      kubeconfigPath,
    ).input;
    const flags: KubernetesInstallInput = resolveCanonicalKubernetesInstallInput(
      nonInteractiveValues(),
      kubeconfigPath,
    ).input;

    expect(interactive).toEqual(flags);
    expect(capture.stderr.join('')).toContain('Installation review:');
    expect(capture.stderr.join('')).toContain('production (https://cluster.example.test:6443)');
  });

  it.each([
    ['--kube-context', { kubeContext: undefined }],
    ['--ingress-class', { ingressClass: undefined }],
    ['--email', { email: undefined }],
    ['--organization', { organization: undefined }],
    ['--admin-password', { password: undefined }],
  ] as const)(
    'reports the exact missing required field %s at the CLI boundary',
    (field: string, override: object): void => {
      expect((): object =>
        resolveCanonicalKubernetesInstallInput({ ...nonInteractiveValues(), ...override }, kubeconfigPath),
      ).toThrow(`Missing required install input: ${field}.`);
    },
  );

  it('uses the cluster default storage class when no override is configured', (): void => {
    expect(
      resolveCanonicalKubernetesInstallInput({ ...nonInteractiveValues(), storageClass: undefined }, kubeconfigPath)
        .input.storageClass,
    ).toBe('');
  });

  it('requires exactly one domain source', (): void => {
    expect((): object =>
      resolveCanonicalKubernetesInstallInput(
        { ...nonInteractiveValues(), baseDomain: 'apps.example.com', managedDomain: true },
        kubeconfigPath,
      ),
    ).toThrow('--managed-domain cannot be combined with --base-domain.');
    expect((): object =>
      resolveCanonicalKubernetesInstallInput({ ...nonInteractiveValues(), managedDomain: undefined }, kubeconfigPath),
    ).toThrow('Missing required install input: --managed-domain or --base-domain.');
  });

  it('rejects conflicting domain flags in the interactive path too', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\n');

    await expect(
      resolveCanonicalKubernetesInstallWizard(
        capture.io,
        {
          adminPassword: 'correct horse battery staple',
          baseDomain: 'apps.example.com',
          managedDomain: true,
          output: 'text',
        },
        { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
        async (): Promise<{ ingressClasses: string[]; storageClasses: { default: boolean; name: string }[] }> =>
          await Promise.resolve({
            ingressClasses: ['nginx'],
            storageClasses: [{ default: true, name: 'fast' }],
          }),
        inspectPublicAcme,
      ),
    ).rejects.toThrow('--managed-domain cannot be combined with --base-domain.');
  });

  it('uses and reviews a retained managed domain without prompting for a new domain', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\nClusterIssuer\nregistry-ca\ny\nowner@example.com\nAcme\ny\n');
    const readResources: Mock<ReadKubernetesInstallResourceInventory> = vi.fn(
      async (): Promise<KubernetesInstallResourceInventory> => {
        return await Promise.resolve({
          ingressClasses: ['nginx'],
          storageClasses: [{ default: true, name: 'fast' }],
        });
      },
    );

    const wizard: KubernetesInstallWizardResult = await resolveCanonicalKubernetesInstallWizard(
      capture.io,
      { adminPassword: 'correct horse battery staple', output: 'text' },
      { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
      readResources,
      inspectPlatformAndRegistryIssuer,
      async (): Promise<RetainedKubernetesInstallState> => await Promise.resolve(retainedManagedState()),
    );

    expect(wizard.input).toMatchObject({ managedDomain: true });
    expect(capture.stderr.join('')).toContain('Domain: acme.compartment.run (retained managed domain)');
    expect(capture.stderr.join('')).not.toContain('Managed Compartment domain [default]');
    expect(capture.stderr.join('')).toContain('Installation review:');
    expect(readResources).toHaveBeenCalledOnce();
  });

  it('keeps operator-owned domain selection available without onboarding authorization', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end(
      '1\ny\n2\napps.example.com\n1\nClusterIssuer\nletsencrypt-production\nClusterIssuer\nregistry-ca\ny\ny\n',
    );

    const wizard: KubernetesInstallWizardResult = await resolveCanonicalKubernetesInstallWizard(
      capture.io,
      {
        adminPassword: 'correct horse battery staple',
        email: 'owner@example.com',
        organization: 'Acme',
        output: 'text',
      },
      { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
      async (): Promise<{ ingressClasses: string[]; storageClasses: { default: boolean; name: string }[] }> =>
        await Promise.resolve({
          ingressClasses: ['nginx'],
          storageClasses: [{ default: true, name: 'fast' }],
        }),
      inspectPlatformAndRegistryIssuer,
    );

    expect(wizard.input).toMatchObject({ baseDomain: 'apps.example.com' });
    expect(wizard.values).toMatchObject({
      ingress: { className: 'nginx' },
      storage: { storageClass: 'fast' },
      tls: { issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-production' } },
    });
    expect(capture.stderr.join('')).toContain('TLS: ClusterIssuer/letsencrypt-production');
    expect(capture.stderr.join('')).toContain('TLS trust warning: Registry CA issuer.');
  });

  it('rejects a self-signed issuer before owner prompts begin', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('1\ny\n2\napps.example.com\n1\nClusterIssuer\nself-signed\n');

    await expect(
      resolveCanonicalKubernetesInstallWizard(
        capture.io,
        { adminPassword: 'correct horse battery staple', output: 'text' },
        { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
        async (): Promise<KubernetesInstallResourceInventory> =>
          await Promise.resolve({
            ingressClasses: ['nginx'],
            storageClasses: [{ default: true, name: 'fast' }],
          }),
        async (): Promise<never> => {
          return await Promise.reject(
            new Error(
              'ClusterIssuer self-signed uses spec.selfSigned; registry node pulls and the CLI public HTTPS probe require trusted TLS.',
            ),
          );
        },
      ),
    ).rejects.toThrow('registry node pulls and the CLI public HTTPS probe require trusted TLS');

    expect(capture.stderr.join('')).not.toContain('Email');
    expect(capture.stderr.join('')).not.toContain('Installation review:');
  });

  it('requires private CA trust confirmation before collecting owner input', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('1\ny\n2\napps.example.com\n1\nIssuer\nprivate-ca\ny\ny\n');

    await expect(
      resolveCanonicalKubernetesInstallWizard(
        capture.io,
        {
          adminPassword: 'correct horse battery staple',
          email: 'owner@example.com',
          organization: 'Acme',
          output: 'text',
        },
        { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
        async (): Promise<KubernetesInstallResourceInventory> =>
          await Promise.resolve({
            ingressClasses: ['nginx'],
            storageClasses: [{ default: true, name: 'fast' }],
          }),
        async (): Promise<{ detail: string; trust: 'ca' }> =>
          await Promise.resolve({
            detail: 'Issuer private-ca uses spec.ca and requires trust distribution.',
            trust: 'ca',
          }),
      ),
    ).resolves.toBeDefined();

    const output: string = capture.stderr.join('');
    expect(output).toContain('TLS trust warning: Issuer private-ca uses spec.ca');
    expect(output).toContain('Confirm that the private CA is distributed');
  });

  it('collects both certificate sources needed when operator platform TLS uses an existing Secret', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('1\ny\n2\napps.example.com\n2\nplatform-tls\nIssuer\nregistry-issuer\ny\ny\n');

    const wizard: KubernetesInstallWizardResult = await resolveCanonicalKubernetesInstallWizard(
      capture.io,
      {
        adminPassword: 'correct horse battery staple',
        email: 'owner@example.com',
        organization: 'Acme',
        output: 'text',
      },
      { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
      async (): Promise<{ ingressClasses: string[]; storageClasses: { default: boolean; name: string }[] }> =>
        await Promise.resolve({
          ingressClasses: ['nginx'],
          storageClasses: [{ default: true, name: 'fast' }],
        }),
      inspectPlatformAndRegistryIssuer,
    );

    expect(wizard.values).toMatchObject({
      registry: { issuerRef: { kind: 'Issuer', name: 'registry-issuer' } },
      tls: { existingSecret: 'platform-tls' },
    });
  });

  it('prompts only for registry TLS on a reserved localhost operator domain', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('1\ny\n2\ncompartment.localhost\nIssuer\nregistry-ca\ny\ny\n');

    const wizard: KubernetesInstallWizardResult = await resolveCanonicalKubernetesInstallWizard(
      capture.io,
      {
        adminPassword: 'correct horse battery staple',
        email: 'owner@example.com',
        organization: 'Acme',
        output: 'text',
      },
      { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
      async (): Promise<KubernetesInstallResourceInventory> =>
        await Promise.resolve({
          ingressClasses: ['traefik'],
          storageClasses: [{ default: true, name: 'local-path' }],
        }),
      inspectPlatformAndRegistryIssuer,
    );

    expect(wizard.values).not.toHaveProperty('tls');
    expect(capture.stderr.join('')).not.toContain('TLS for the operator-owned domain:');
    expect(capture.stderr.join('')).toContain('TLS: public TLS not required; registry Issuer/registry-ca');
  });

  it('stops before owner prompts with a complete values example when the operator declines TLS setup', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('1\ny\n2\napps.example.com\n3\n');

    const failure: Error = await readWizardFailure(
      resolveCanonicalKubernetesInstallWizard(
        capture.io,
        { adminPassword: 'correct horse battery staple', output: 'text' },
        { contexts: [{ apiServer: 'https://cluster.example.test', name: 'production' }] },
        async (): Promise<{ ingressClasses: string[]; storageClasses: { default: boolean; name: string }[] }> =>
          await Promise.resolve({
            ingressClasses: ['nginx'],
            storageClasses: [{ default: true, name: 'fast' }],
          }),
        inspectPublicAcme,
      ),
    );
    expect(failure.message).toContain('Operator-owned domain installation stopped before owner setup.');
    expect(failure.message).toContain('ingress:\n  className: nginx');
    expect(failure.message).toContain('tls:\n  issuerRef:');
    expect(failure.message).toContain('storage:\n  storageClass: fast');
    expect(failure.message).toContain('--base-domain apps.example.com');
    expect(failure.message).toContain('--kube-context production');
    expect(failure.message).toContain('--values compartment-values.yaml');

    const output: string = capture.stderr.join('');
    expect(output).not.toContain('Email');
    expect(output).not.toContain('Installation review:');
  });

  it('discovers ingress and storage from the context selected by the operator', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('2\n\nClusterIssuer\nregistry-ca\ny\ny\n');
    const selectedContexts: string[] = [];
    const wizard: KubernetesInstallWizardResult = await resolveCanonicalKubernetesInstallWizard(
      capture.io,
      {
        adminPassword: 'correct horse battery staple',
        email: 'owner@example.com',
        managedDomain: true,
        organization: 'Acme',
        output: 'text',
      },
      {
        contexts: [
          { apiServer: 'https://first.example.test', name: 'first' },
          { apiServer: 'https://second.example.test', name: 'second' },
        ],
      },
      async (
        contextName: string,
      ): Promise<{ ingressClasses: string[]; storageClasses: { default: boolean; name: string }[] }> => {
        selectedContexts.push(contextName);
        return await Promise.resolve({
          ingressClasses: [contextName === 'second' ? 'nginx' : 'wrong'],
          storageClasses: [{ default: true, name: contextName === 'second' ? 'fast' : 'wrong' }],
        });
      },
      inspectPlatformAndRegistryIssuer,
    );

    expect(selectedContexts).toEqual(['second']);
    expect(wizard.input).toMatchObject({ ingressClass: 'nginx', kubeContext: 'second', storageClass: 'fast' });
  });

  it.each([
    ['email', { email: 'not-an-email' }, '--email:'],
    ['password', { password: 'short' }, '--admin-password:'],
  ] as const)(
    'validates canonical owner %s for non-interactive input',
    (label: string, override: object, message: string): void => {
      expect((): object =>
        resolveCanonicalKubernetesInstallInput({ ...nonInteractiveValues(), ...override }, kubeconfigPath),
      ).toThrow(message);
    },
  );

  it('applies field-specific namespace and Helm release limits', (): void => {
    expect((): object =>
      resolveCanonicalKubernetesInstallInput({ ...nonInteractiveValues(), namespace: 'n'.repeat(64) }, kubeconfigPath),
    ).toThrow('--namespace must be a valid Kubernetes name.');
    expect((): object =>
      resolveCanonicalKubernetesInstallInput(
        { ...nonInteractiveValues(), releaseName: 'r'.repeat(54) },
        kubeconfigPath,
      ),
    ).toThrow('--release-name must be a valid Kubernetes name.');
    expect((): object =>
      resolveCanonicalKubernetesInstallInput(
        { ...nonInteractiveValues(), releaseName: 'release.name' },
        kubeconfigPath,
      ),
    ).toThrow('--release-name must be a valid Kubernetes name.');
  });

  it('accepts IPv4, IPv6, and host ingress endpoints but rejects malformed numeric addresses', (): void => {
    for (const endpoint of ['192.0.2.10', '2001:db8::1', 'ingress.example.com']) {
      expect(
        resolveCanonicalKubernetesInstallInput({ ...nonInteractiveValues(), ingressEndpoint: endpoint }, kubeconfigPath)
          .input.ingressEndpoint,
      ).toBe(endpoint);
    }
    expect((): object =>
      resolveCanonicalKubernetesInstallInput(
        { ...nonInteractiveValues(), ingressEndpoint: '999.999.999.999' },
        kubeconfigPath,
      ),
    ).toThrow('--ingress-endpoint must be an IP address or DNS hostname.');
  });
});

function retainedManagedState(): RetainedKubernetesInstallState {
  return {
    acmeEmail: 'previous@compartment.run',
    baseDomain: 'acme.compartment.run',
    brokerUrl: 'https://broker.compartment.run',
    domainMode: 'managed',
    ingressClassName: 'nginx',
    ingressEndpoint: { type: 'A', value: retainedIngressIp },
    ingressTargets: [{ type: 'A', value: retainedIngressIp }],
    installationId: 'installation-123',
    managedDomainAcmeDnsToken: 'retained-token',
    publicProtocol: 'https',
    registryHostname: retainedRegistryIp,
    registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'registry-ca' },
    tlsMode: 'broker-dns01',
  };
}

function nonInteractiveValues(): KubernetesInstallInputValues {
  return {
    email: 'owner@example.com',
    ingressClass: 'nginx',
    kubeContext: 'production',
    managedDomain: true,
    namespace: 'compartment',
    organization: 'Acme',
    password: 'correct horse battery staple',
    releaseName: 'compartment',
    storageClass: 'fast',
    valuesPath,
  };
}

async function readWizardFailure(promise: Promise<KubernetesInstallWizardResult>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error('Expected the Kubernetes install wizard to fail.');
  }
  throw new Error('Expected the Kubernetes install wizard to fail.');
}
