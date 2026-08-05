import type { ManagedVmPreflightResult } from '../../services/managed-vm-provisioning.types';
import { renderManagedVmFirewallRules } from '../../services/managed-vm-firewall.service';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';

export function buildManagedVmReview(
  preflight: ManagedVmPreflightResult,
  identity: ResolvedInstallIdentityPrompts,
  options: InstallCommandOptions,
): string {
  return `${buildManagedVmReviewHeader(preflight, identity, options)}${buildManagedVmHostReview(preflight)}`;
}

function buildManagedVmReviewHeader(
  preflight: ManagedVmPreflightResult,
  identity: ResolvedInstallIdentityPrompts,
  options: InstallCommandOptions,
): string {
  return `\nInstallation review
  Target: this VM
  Domain: ${options.managedDomain === true ? 'managed' : options.baseDomain}
  Owner: ${identity.adminEmail}
  Organization: ${identity.organizationName}
Managed Kubernetes
  Kubernetes: k3s ${preflight.metadata.k3sVersion} (${preflight.metadata.k3sChannel})
  kubectl: provided by k3s
  Helm: ${preflight.metadata.helmVersion}
  Topology: single node, embedded etcd
`;
}

function buildManagedVmHostReview(preflight: ManagedVmPreflightResult): string {
  return `Host changes
  /usr/local/bin/compartment, k3s, helm
  /etc/compartment and /etc/rancher/k3s
  /var/lib/rancher/k3s and /var/lib/compartment/installer
  systemd services: compartment-firewall, k3s
  Automatic components: cert-manager, internal registry CA/Issuer, node CA trust, gVisor/runsc
  Firewall rules on ${preflight.inventory.publicInterface}:
${indentManagedVmReview(renderManagedVmFirewallRules(preflight.inventory.publicInterface), '    ')}
`;
}

export function parseManagedVmObservedAddress(body: string): string {
  const traceAddress: string | undefined = body
    .split('\n')
    .find((line: string): boolean => line.startsWith('ip='))
    ?.slice(3);
  return traceAddress ?? body;
}

function indentManagedVmReview(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line: string): string => `${prefix}${line}`)
    .join('\n');
}
