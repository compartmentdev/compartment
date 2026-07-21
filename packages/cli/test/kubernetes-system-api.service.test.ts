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

  it('reports a failed API deployment lookup', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue(failedCommand('forbidden'));

    await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(
      'Failed to find the API deployment: forbidden',
    );
    expect(mocks.runCommandWithInput).not.toHaveBeenCalled();
  });

  it.each([
    ['no', JSON.stringify({ items: [] })],
    [
      'multiple',
      JSON.stringify({
        items: [{ metadata: { name: 'compartment-api-a' } }, { metadata: { name: 'compartment-api-b' } }],
      }),
    ],
  ])('rejects %s API deployments for the release', async (_label: string, output: string): Promise<void> => {
    mocks.runCommand.mockResolvedValue(successfulCommand(output));

    await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(
      'Expected exactly one API deployment for the Helm release.',
    );
    expect(mocks.runCommandWithInput).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{', 'Invalid JSON returned by API deployment lookup.'],
    ['a missing items array', '{}', 'kubectl returned an invalid API deployment list.'],
    [
      'a deployment without a name',
      JSON.stringify({ items: [{ metadata: {} }] }),
      'Expected exactly one API deployment for the Helm release.',
    ],
  ])(
    'rejects deployment lookup output with %s',
    async (_label: string, output: string, message: string): Promise<void> => {
      mocks.runCommand.mockResolvedValue(successfulCommand(output));

      await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(message);
      expect(mocks.runCommandWithInput).not.toHaveBeenCalled();
    },
  );

  it('reports a failed kubectl exec request', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue(successfulCommand(deploymentListResponse()));
    mocks.runCommandWithInput.mockResolvedValue(failedCommand('socket unavailable'));

    await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(
      'Private system API request failed: socket unavailable',
    );
  });

  it.each([
    [
      'the API error message',
      JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Account is not eligible.' } }),
      'Account is not eligible.',
    ],
    [
      'the generic fallback for an invalid error body',
      JSON.stringify({ message: 'internal detail' }),
      'Private system API request failed.',
    ],
  ])('reports %s for an error response', async (_label: string, body: string, message: string): Promise<void> => {
    mocks.runCommand.mockResolvedValue(successfulCommand(deploymentListResponse()));
    mocks.runCommandWithInput.mockResolvedValue(successfulCommand(responseEnvelope(422, body)));

    await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(message);
  });

  it('rejects an invalid private API response envelope', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue(successfulCommand(deploymentListResponse()));
    mocks.runCommandWithInput.mockResolvedValue(successfulCommand(JSON.stringify({ body: '{}', statusCode: '200' })));

    await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(
      'kubectl exec returned an invalid private system API response.',
    );
  });

  it('rejects malformed private API response JSON', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue(successfulCommand(deploymentListResponse()));
    mocks.runCommandWithInput.mockResolvedValue(successfulCommand('{'));

    await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(
      'Invalid JSON returned by kubectl exec response.',
    );
  });

  it('rejects malformed JSON in a successful private API response body', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue(successfulCommand(deploymentListResponse()));
    mocks.runCommandWithInput.mockResolvedValue(successfulCommand(responseEnvelope(200, '{')));

    await expect(issueKubernetesPasswordReset(target, 'owner@example.com')).rejects.toThrow(
      'Invalid JSON returned by system API response.',
    );
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

function failedCommand(stderr: string): CommandResult {
  return { exitCode: 1, stderr, stdout: '' };
}

function deploymentListResponse(): string {
  return JSON.stringify({ items: [{ metadata: { name: 'compartment-compartment-api' } }] });
}

function passwordResetResponseEnvelope(): string {
  return responseEnvelope(
    200,
    JSON.stringify({
      email: 'owner@example.com',
      expiresAt: '2026-07-17T12:00:00.000Z',
      resetToken: 'one-time-reset-token',
      resetUrl: 'https://console.example.com/reset-password?token=one-time-reset-token',
    }),
  );
}

function responseEnvelope(statusCode: number, body: string): string {
  return JSON.stringify({ body, statusCode });
}
