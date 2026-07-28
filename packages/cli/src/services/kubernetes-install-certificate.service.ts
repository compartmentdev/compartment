import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type { KubernetesInstallDeploymentInput } from './kubernetes-install.service.types';

const certificateWaitTimeoutMs: number = 10 * 60_000;

export async function waitForKubernetesPlatformCertificates(input: KubernetesInstallDeploymentInput): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, [
      'wait',
      'certificates.cert-manager.io',
      '--selector',
      `app.kubernetes.io/instance=${input.releaseName},app.kubernetes.io/component=platform-tls`,
      '--for=condition=Ready',
      '--timeout=10m',
    ]),
    certificateWaitTimeoutMs,
  );
  if (result.exitCode === 0) {
    return;
  }
  const output: string = readCommandOutput(result);
  throw new Error(
    `Platform Certificate resources did not reach Ready=True; the installation remains incomplete. Fix DNS or issuer configuration, then re-run install to resume.${output === '' ? '' : `\n${output}`}`,
  );
}
