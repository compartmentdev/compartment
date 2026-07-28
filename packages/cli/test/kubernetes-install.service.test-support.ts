import type { CommandResult } from '../src/command-runner.types';
import type { KubernetesInstallProgressReporter } from '../src/services/kubernetes-install-progress.types';
import type { Mock } from 'vitest';

export interface ImageTrustWriteInput {
  outputPath: string;
}

export interface KubernetesInstallServiceMocks {
  runCommand: Mock<RunCommand>;
  usesOperatorTlsSecret: Mock<(valuesPath: string) => Promise<boolean>>;
  writeVerifiedImages: Mock<(input: ImageTrustWriteInput) => Promise<void>>;
}

export type RunCommandCall = [command: readonly string[]];
type RunCommand = (command: readonly string[]) => Promise<CommandResult>;

export function ingressAddressList(addresses: readonly string[]): string {
  return JSON.stringify({
    items: [
      {
        status: { loadBalancer: { ingress: addresses.map((ip: string): { ip: string } => ({ ip })) } },
      },
    ],
  });
}

export function encodeSecretValue(value: string): string {
  return Buffer.from(value).toString('base64');
}

export function deployedReleaseList(): string {
  return helmReleaseList('deployed');
}

export function helmReleaseList(status: string): string {
  return JSON.stringify([{ name: 'compartment', status }]);
}

export function readyControlPlaneResponse(): Response {
  return new Response(null, { headers: { location: '/login' }, status: 302 });
}

export function successfulCommandResult(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

export function createFetchConnectionError(code: string): Error {
  const error: Error = new TypeError('fetch failed');
  (error as Error & { cause?: { code?: string | undefined } | undefined }).cause = { code };
  return error;
}

export class RecordingProgressReporter implements KubernetesInstallProgressReporter {
  public constructor(private readonly events: string[]) {}
  public report(message: string): void {
    this.events.push(message);
  }
}
