import { describe, expect, it } from 'vitest';
import { renderManagedVmFirewallRules } from '../src/services/managed-vm-firewall.service';

describe('managed VM firewall contract', (): void => {
  it('blocks only cluster ports on the selected public interface', (): void => {
    const rules: string = renderManagedVmFirewallRules('ens3');
    expect(rules).toContain('iifname "ens3" tcp dport { 2379, 2380, 6443, 10250 } drop');
    expect(rules).toContain('iifname "ens3" udp dport 8472 drop');
    expect(rules).toContain('comment "compartment-owned"');
    expect(rules).not.toContain('dport 22');
    expect(rules).not.toContain('dport { 80, 443 } drop');
  });
});
