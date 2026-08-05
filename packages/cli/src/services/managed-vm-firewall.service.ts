import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import { installNewManagedVmFile } from './managed-vm-owned-file.service';

const managedVmFirewallRulesPath: string = '/etc/compartment/firewall.nft';
const managedVmFirewallUnitPath: string = '/etc/systemd/system/compartment-firewall.service';

export async function installManagedVmFirewall(publicInterface: string): Promise<Readonly<Record<string, string>>> {
  await assertExistingFirewallIsOwned(publicInterface);
  const rules: string = renderManagedVmFirewallRules(publicInterface);
  const unit: string = renderFirewallUnit();
  const identities: Readonly<Record<string, string>> = {
    [managedVmFirewallRulesPath]: await installNewManagedVmFile(managedVmFirewallRulesPath, rules, 0o600),
    [managedVmFirewallUnitPath]: await installNewManagedVmFile(managedVmFirewallUnitPath, unit, 0o644),
  };
  await execa('nft', ['delete', 'table', 'inet', 'compartment'], { reject: false });
  await execa('systemctl', ['daemon-reload']);
  await execa('systemctl', ['enable', '--now', '--force', 'compartment-firewall.service']);
  return identities;
}

async function assertExistingFirewallIsOwned(publicInterface: string): Promise<void> {
  const result: ManagedVmCommandResult = await execa('nft', ['list', 'table', 'inet', 'compartment'], {
    reject: false,
  });
  if (result.exitCode !== 0) {
    return;
  }
  if (!isOwnedFirewallOutput(result.stdout, publicInterface)) {
    throw new Error('A foreign nftables table named inet compartment exists; refusing to replace it.');
  }
}

export async function verifyManagedVmFirewall(publicInterface: string): Promise<boolean> {
  const result: ManagedVmCommandResult = await execa('nft', ['list', 'table', 'inet', 'compartment'], {
    reject: false,
  });
  if (result.exitCode !== 0) {
    return false;
  }
  return isOwnedFirewallOutput(result.stdout, publicInterface);
}

function isOwnedFirewallOutput(output: string, publicInterface: string): boolean {
  return (
    output.includes('compartment-owned') &&
    output.includes(publicInterface) &&
    ['2379', '2380', '6443', '10250', '8472'].every((port: string): boolean => output.includes(port))
  );
}

export function renderManagedVmFirewallRules(publicInterface: string): string {
  return `table inet compartment {
  chain input {
    type filter hook input priority -5; policy accept;
    iifname "${publicInterface}" tcp dport { 2379, 2380, 6443, 10250 } drop comment "compartment-owned"
    iifname "${publicInterface}" udp dport 8472 drop comment "compartment-owned"
  }
}
`;
}

function renderFirewallUnit(): string {
  return `[Unit]
Description=Compartment-owned Kubernetes port isolation
Before=k3s.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=-/usr/sbin/nft delete table inet compartment
ExecStart=/usr/sbin/nft -f ${managedVmFirewallRulesPath}
ExecStop=-/usr/sbin/nft delete table inet compartment

[Install]
WantedBy=multi-user.target
`;
}
