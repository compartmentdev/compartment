import type { IssuePasswordResetResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { issueKubernetesPasswordReset } from '../src/services/kubernetes-password-recovery.service';
import type { KubernetesOperatorTarget } from '../src/services/kubernetes-operator.service.types';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type RunCommandWithInput = (command: readonly string[], input: string) => Promise<CommandResult>;

interface SystemApiCommandMocks {
  runCommand: Mock<RunCommand>;
  runCommandWithInput: Mock<RunCommandWithInput>;
}

const mocks: SystemApiCommandMocks = vi.hoisted(
  (): SystemApiCommandMocks => ({
    runCommand: vi.fn<RunCommand>(),
    runCommandWithInput: vi.fn<RunCommandWithInput>(),
  }),
);

vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
  runCommandWithInput: mocks.runCommandWithInput,
}));

const target: KubernetesOperatorTarget = {
  kubeContext: 'production',
  namespace: 'compartment',
  releaseName: 'compartment',
};

describe('Kubernetes private system API transport', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
    mocks.runCommandWithInput.mockReset();
  });

  it('uses the API deployment Unix socket without copying the system token out of the pod', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue(successfulCommand(deploymentListResponse()));
    mocks.runCommandWithInput.mockResolvedValue(successfulCommand(passwordResetResponseEnvelope()));

    const result: IssuePasswordResetResponse = await issueKubernetesPasswordReset(target, 'owner@example.com');

    expect(result.resetToken).toBe('one-time-reset-token');
    expect(mocks.runCommandWithInput).toHaveBeenCalledTimes(1);
    const [command, input]: [readonly string[], string] = readExecCall();
    expect(command.slice(0, 6)).toEqual(['kubectl', '--context', 'production', '--namespace', 'compartment', 'exec']);
    expect(command.slice(6, 11)).toEqual([
      '--stdin',
      '--container',
      'api',
      'deployment/compartment-compartment-api',
      '--',
    ]);
    expect(command.join(' ')).not.toContain('one-time-reset-token');
    expect(input).toContain('/internal/system/auth/password-reset/issue');
    expect(input).toContain('owner@example.com');
    expect(input).not.toContain('one-time-reset-token');
  });
});

function readExecCall(): [readonly string[], string] {
  const call: [command: readonly string[], input: string] | undefined = mocks.runCommandWithInput.mock.calls[0];
  if (call === undefined || !Array.isArray(call[0]) || typeof call[1] !== 'string') {
    throw new Error('Expected one kubectl exec call.');
  }
  return [call[0] as readonly string[], call[1]];
}

function successfulCommand(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

function deploymentListResponse(): string {
  return JSON.stringify({ items: [{ metadata: { name: 'compartment-compartment-api' } }] });
}

function passwordResetResponseEnvelope(): string {
  return JSON.stringify({
    body: JSON.stringify({
      email: 'owner@example.com',
      expiresAt: '2026-07-17T12:00:00.000Z',
      resetToken: 'one-time-reset-token',
      resetUrl: 'https://console.example.com/reset-password?token=one-time-reset-token',
    }),
    statusCode: 200,
  });
}
