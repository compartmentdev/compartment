import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { syncDockerNetworkEgressDenyRules } from '../src/docker-network-egress';
import type { ProcessCommandInput, ProcessCommandResult } from '../src/process-command.types';

type RunProcessCommand = (input: ProcessCommandInput) => Promise<ProcessCommandResult>;

interface DockerNetworkEgressTestMocks {
  runProcessCommand: Mock<RunProcessCommand>;
}

const mocks: DockerNetworkEgressTestMocks = vi.hoisted(
  (): DockerNetworkEgressTestMocks => ({
    runProcessCommand: vi.fn<RunProcessCommand>(),
  }),
);

vi.mock('../src/process-command', (): { runProcessCommand: Mock<RunProcessCommand> } => ({
  runProcessCommand: mocks.runProcessCommand,
}));

afterEach((): void => {
  mocks.runProcessCommand.mockReset();
});

describe('syncDockerNetworkEgressDenyRules', (): void => {
  it('uses nftables rules scoped by runtime source and denied destination', async (): Promise<void> => {
    const gatewayCidr: string = buildIpv4Cidr([172, 17, 0, 1], 32);
    const linkLocalCidr: string = buildIpv4Cidr([169, 254, 0, 0], 16);
    const sourceAllowCidr: string = buildIpv4Cidr([172, 30, 0, 2], 32);
    const sourceSubnet: string = buildIpv4Cidr([172, 30, 0, 0], 16);
    let nftBatchContent: string = '';
    mocks.runProcessCommand.mockImplementation(async (input: ProcessCommandInput): Promise<ProcessCommandResult> => {
      await Promise.resolve();
      if (input.file === 'nft' && input.args.join(' ') === '--version') {
        return { stderr: '', stdout: 'nftables v1.0.0' };
      }
      if (input.file === 'nft' && input.args[0] === '-f') {
        const batchPath: string | undefined = input.args[1];
        if (batchPath === undefined) {
          throw new Error('Expected nft batch path.');
        }
        nftBatchContent = await readFile(batchPath, 'utf8');
      }

      return { stderr: '', stdout: '' };
    });

    await syncDockerNetworkEgressDenyRules({
      destinationCidrs: [linkLocalCidr, gatewayCidr],
      namespace: 'compartment-test',
      sourceAllowCidrs: [sourceAllowCidr],
      sourceSubnets: [sourceSubnet],
    });

    expect(nftBatchContent).toMatch(/^delete table inet compartment_egress_[a-f0-9]{12}$/mu);
    expect(nftBatchContent).toMatch(/^add table inet compartment_egress_[a-f0-9]{12}$/mu);
    expect(nftBatchContent).toContain(`ip saddr ${sourceAllowCidr} accept`);
    expect(nftBatchContent).toContain(`ip saddr ${sourceSubnet} ip daddr ${linkLocalCidr} drop`);
    expect(nftBatchContent).toContain(`ip saddr ${sourceSubnet} ip daddr ${gatewayCidr} drop`);
    expect(nftBatchContent.indexOf(`ip saddr ${sourceAllowCidr} accept`)).toBeLessThan(
      nftBatchContent.indexOf(`ip saddr ${sourceSubnet} ip daddr ${linkLocalCidr} drop`),
    );
    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: ['-f', expect.stringMatching(/\/nft$/u)],
      file: 'nft',
    });
    expect(mocks.runProcessCommand).not.toHaveBeenCalledWith({
      args: ['delete', 'table', 'inet', expect.any(String)],
      file: 'nft',
    });
  });

  it('falls back to DOCKER-USER and INPUT iptables chains', async (): Promise<void> => {
    const gatewayCidr: string = buildIpv4Cidr([172, 17, 0, 1], 32);
    const sourceAllowCidr: string = buildIpv4Cidr([172, 30, 0, 2], 32);
    const sourceSubnet: string = buildIpv4Cidr([172, 30, 0, 0], 16);
    mocks.runProcessCommand.mockImplementation(async (input: ProcessCommandInput): Promise<ProcessCommandResult> => {
      await Promise.resolve();
      if (input.file === 'nft') {
        throw new Error('nft unavailable');
      }
      if (input.file === 'iptables' && input.args[2] === '-C') {
        throw new Error('missing jump');
      }

      return {
        stderr: '',
        stdout: input.file === 'iptables' && input.args[0] === '--version' ? 'iptables v1.8.0' : '',
      };
    });

    await syncDockerNetworkEgressDenyRules({
      destinationCidrs: [gatewayCidr],
      namespace: 'compartment-test',
      sourceAllowCidrs: [sourceAllowCidr],
      sourceSubnets: [sourceSubnet],
    });

    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: [
        '-w',
        '10',
        '-A',
        expect.stringMatching(/^CMP-EG-[a-f0-9]{12}-F$/u),
        '-s',
        sourceAllowCidr,
        '-j',
        'RETURN',
      ],
      file: 'iptables',
    });
    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: [
        '-w',
        '10',
        '-A',
        expect.stringMatching(/^CMP-EG-[a-f0-9]{12}-F$/u),
        '-s',
        sourceSubnet,
        '-d',
        gatewayCidr,
        '-j',
        'DROP',
      ],
      file: 'iptables',
    });
    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: [
        '-w',
        '10',
        '-A',
        expect.stringMatching(/^CMP-EG-[a-f0-9]{12}-I$/u),
        '-s',
        sourceAllowCidr,
        '-j',
        'RETURN',
      ],
      file: 'iptables',
    });
    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: [
        '-w',
        '10',
        '-A',
        expect.stringMatching(/^CMP-EG-[a-f0-9]{12}-I$/u),
        '-s',
        sourceSubnet,
        '-d',
        gatewayCidr,
        '-j',
        'DROP',
      ],
      file: 'iptables',
    });
    expect(readIptablesAppendCallIndex('-F', sourceAllowCidr, 'RETURN')).toBeLessThan(
      readIptablesAppendCallIndex('-F', sourceSubnet, 'DROP'),
    );
    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: ['-w', '10', '-I', 'DOCKER-USER', '1', '-j', expect.stringMatching(/^CMP-EG-[a-f0-9]{12}-F$/u)],
      file: 'iptables',
    });
    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: ['-w', '10', '-I', 'INPUT', '1', '-j', expect.stringMatching(/^CMP-EG-[a-f0-9]{12}-I$/u)],
      file: 'iptables',
    });
  });

  it('falls back to iptables when nftables is installed without rule-management access', async (): Promise<void> => {
    const gatewayCidr: string = buildIpv4Cidr([172, 17, 0, 1], 32);
    const sourceSubnet: string = buildIpv4Cidr([172, 30, 0, 0], 16);
    mocks.runProcessCommand.mockImplementation(async (input: ProcessCommandInput): Promise<ProcessCommandResult> => {
      await Promise.resolve();
      if (input.file === 'nft' && input.args.join(' ') === '--version') {
        return { stderr: '', stdout: 'nftables v1.0.0' };
      }
      if (input.file === 'nft') {
        throw new Error('netlink: Operation not permitted');
      }
      if (input.file === 'iptables' && input.args[2] === '-C') {
        throw new Error('missing jump');
      }

      return {
        stderr: '',
        stdout: input.file === 'iptables' && input.args[0] === '--version' ? 'iptables v1.8.0' : '',
      };
    });

    await syncDockerNetworkEgressDenyRules({
      destinationCidrs: [gatewayCidr],
      namespace: 'compartment-test',
      sourceSubnets: [sourceSubnet],
    });

    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: ['list', 'ruleset'],
      file: 'nft',
    });
    expect(mocks.runProcessCommand).toHaveBeenCalledWith({
      args: [
        '-w',
        '10',
        '-A',
        expect.stringMatching(/^CMP-EG-[a-f0-9]{12}-F$/u),
        '-s',
        sourceSubnet,
        '-d',
        gatewayCidr,
        '-j',
        'DROP',
      ],
      file: 'iptables',
    });
  });

  it('fails closed when no firewall backend is available', async (): Promise<void> => {
    mocks.runProcessCommand.mockRejectedValue(new Error('command unavailable'));

    await expect(
      syncDockerNetworkEgressDenyRules({
        destinationCidrs: [buildIpv4Cidr([169, 254, 0, 0], 16)],
        namespace: 'compartment-test',
        sourceSubnets: [buildIpv4Cidr([172, 30, 0, 0], 16)],
      }),
    ).rejects.toThrow('Docker runtime egress deny rules require nftables or iptables on the Docker host.');
  });

  it('allows empty cleanup when no firewall backend is available', async (): Promise<void> => {
    mocks.runProcessCommand.mockRejectedValue(new Error('command unavailable'));

    await expect(
      syncDockerNetworkEgressDenyRules({
        destinationCidrs: [],
        namespace: 'compartment-test',
        sourceSubnets: [],
      }),
    ).resolves.toBeUndefined();
  });
});

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv4Cidr(octets: readonly [number, number, number, number], prefixLength: number): string {
  return `${buildIpv4Address(octets)}/${prefixLength.toString()}`;
}

function readIptablesAppendCallIndex(chainSuffix: string, sourceCidr: string, target: string): number {
  const index: number = mocks.runProcessCommand.mock.calls.findIndex(([input]: [ProcessCommandInput]): boolean => {
    const chainName: string | undefined = input.args[3];
    return (
      input.file === 'iptables' &&
      input.args[2] === '-A' &&
      chainName !== undefined &&
      chainName.endsWith(chainSuffix) &&
      input.args.includes(sourceCidr) &&
      input.args[input.args.length - 1] === target
    );
  });
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}
