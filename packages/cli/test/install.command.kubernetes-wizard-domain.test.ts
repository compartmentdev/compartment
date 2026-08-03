import { describe, expect, it, vi, type Mock } from 'vitest';
import type { CliIo } from '../src/app.types';
import { resolveKubernetesInstallWizardDomainForSelection } from '../src/commands/install/install.command.kubernetes-wizard-domain';
import type {
  InspectKubernetesInstallIssuer,
  KubernetesInstallWizardClusterSelection,
  KubernetesInstallWizardDomain,
} from '../src/commands/install/install.command.kubernetes-wizard.types';
import type { InstallCommandOptions } from '../src/commands/install/install.command.types';
import type { OperatorDomainTlsPromptInput } from '../src/commands/install/install.command.kubernetes-wizard-tls';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

type PromptVisibleText = (io: CliIo, label: string, defaultValue?: string) => Promise<string>;
type PromptRequiredVisibleText = (io: CliIo, label: string) => Promise<string>;
type ResolveOperatorDomainTls = (
  io: CliIo,
  input: OperatorDomainTlsPromptInput,
) => Promise<KubernetesInstallWizardDomain>;

interface WizardDomainMocks {
  promptRequiredVisibleText: Mock<PromptRequiredVisibleText>;
  promptVisibleText: Mock<PromptVisibleText>;
  resolveOperatorDomainTls: Mock<ResolveOperatorDomainTls>;
}

const mocks: WizardDomainMocks = vi.hoisted(
  (): WizardDomainMocks => ({
    promptRequiredVisibleText: vi.fn<PromptRequiredVisibleText>(),
    promptVisibleText: vi.fn<PromptVisibleText>(),
    resolveOperatorDomainTls: vi.fn<ResolveOperatorDomainTls>(),
  }),
);

vi.mock('../src/prompts/prompt', (): object => ({
  promptRequiredVisibleText: mocks.promptRequiredVisibleText,
  promptVisibleText: mocks.promptVisibleText,
}));
vi.mock('../src/commands/install/install.command.kubernetes-wizard-tls', (): object => ({
  resolveOperatorDomainTls: mocks.resolveOperatorDomainTls,
}));

const selection: KubernetesInstallWizardClusterSelection = {
  ingressClass: 'nginx',
  kubeContext: 'production',
  storageClass: 'standard',
};
const inspectIssuer: InspectKubernetesInstallIssuer = vi.fn<InspectKubernetesInstallIssuer>();

describe('Kubernetes install wizard domain selection', (): void => {
  it('rejects explicit managed mode for a hostname endpoint with operator-domain guidance', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    const options: InstallCommandOptions = {
      ingressEndpoint: 'load-balancer.example.net',
      managedDomain: true,
      output: 'text',
    };

    await expect(
      resolveKubernetesInstallWizardDomainForSelection(capture.io, options, selection, inspectIssuer),
    ).rejects.toThrow(
      'Managed domains are unavailable for a hostname Ingress endpoint because the broker can publish only A/AAAA records to an IP address. Use your own domain with --base-domain instead.',
    );
    expect(mocks.promptVisibleText).not.toHaveBeenCalled();
  });

  it('skips the managed choice and prompts only for an operator-owned domain for a hostname endpoint', async (): Promise<void> => {
    mocks.promptRequiredVisibleText.mockResolvedValueOnce('apps.example.com');
    mocks.resolveOperatorDomainTls.mockResolvedValueOnce({
      input: { baseDomain: 'apps.example.com' },
      tlsReview: 'ClusterIssuer/public-acme',
    });
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });
    const options: InstallCommandOptions = {
      ingressEndpoint: 'load-balancer.example.net',
      output: 'text',
    };

    const result: KubernetesInstallWizardDomain = await resolveKubernetesInstallWizardDomainForSelection(
      capture.io,
      options,
      selection,
      inspectIssuer,
    );

    expect(result.input).toEqual({ baseDomain: 'apps.example.com' });
    expect(mocks.promptRequiredVisibleText).toHaveBeenCalledOnce();
    expect(mocks.promptRequiredVisibleText).toHaveBeenCalledWith(capture.io, 'Operator-owned base domain');
    expect(mocks.resolveOperatorDomainTls).toHaveBeenCalledWith(
      capture.io,
      expect.objectContaining({ baseDomain: 'apps.example.com' }),
    );
    expect(readCliStderr(capture)).toContain('Managed Compartment domains are unavailable');
    expect(readCliStderr(capture)).not.toContain('Managed Compartment domain [default]');
  });
});
