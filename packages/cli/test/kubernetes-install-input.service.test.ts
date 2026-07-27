import { describe, expect, it } from 'vitest';
import { resolveCanonicalKubernetesInstallInput } from '../src/commands/install/install.command.input';
import { resolveCanonicalKubernetesInstallWizard } from '../src/commands/install/install.command.kubernetes-wizard';
import type { InstallCommandOptions } from '../src/commands/install/install.command.types';
import type { KubernetesInstallInputValues } from '../src/commands/install/install.command.input.types';
import type { KubernetesInstallWizardResult } from '../src/commands/install/install.command.kubernetes-wizard.types';
import type { KubernetesInstallInput } from '../src/services/kubernetes-install-input.service.types';
import { createCliCapture, type CliCommandCapture } from './cli-test.harness';

const kubeconfigPath: string = '/tmp/kubeconfig';
const valuesPath: string = '/tmp/values.yaml';

describe('canonical Kubernetes install input', (): void => {
  it('produces the same validated input from interactive answers and flags', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('\n\n\nowner@example.com\nAcme\ny\n');
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
    ['--storage-class', { storageClass: undefined }],
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
      ),
    ).rejects.toThrow('--managed-domain cannot be combined with --base-domain.');
  });

  it('discovers ingress and storage from the context selected by the operator', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    capture.stdin.end('2\n\ny\n');
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

  it('has no existingCluster discriminator in the runtime contract', (): void => {
    const input: KubernetesInstallInput = resolveCanonicalKubernetesInstallInput(
      nonInteractiveValues(),
      kubeconfigPath,
    ).input;

    expect(Object.hasOwn(input, 'existingCluster')).toBe(false);
  });
});

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
