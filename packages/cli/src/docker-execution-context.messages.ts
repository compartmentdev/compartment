import type { DockerExecutionMode } from './docker-runtime.types';

interface DockerExecutionFailureProbe {
  interactiveSudoTried?: boolean | undefined;
  kind: 'missing' | 'unavailable';
}

export function readDockerExecutionSwitchMessage(mode: DockerExecutionMode, directComposeExitCode: number): string {
  const prefix: string =
    directComposeExitCode === 0
      ? 'Direct Docker daemon access is unavailable.'
      : 'Direct Docker access is unavailable.';
  return mode === 'sudo-n'
    ? `${prefix} Using passwordless sudo for Docker commands.`
    : `${prefix} Using sudo for Docker commands; you may be prompted for your password.`;
}

export function readInteractiveSudoProbeMessage(directComposeExitCode: number): string {
  const prefix: string =
    directComposeExitCode === 0
      ? 'Direct Docker daemon access is unavailable.'
      : 'Direct Docker access is unavailable.';
  return `${prefix} Checking Docker access via sudo; you may be prompted for your password.`;
}

export function readDockerExecutionContextMessage(probeResult: DockerExecutionFailureProbe): string {
  if (probeResult.kind === 'missing') {
    return 'Docker Engine with the Docker Compose plugin is required before self-hosted runtime management. Install Docker manually and re-run `compartment install` or `compartment system update`.';
  }

  return probeResult.interactiveSudoTried === true
    ? 'Docker Engine and the Docker Compose plugin are installed, but this session cannot access the Docker daemon through `docker`, `sudo -n docker`, or `sudo docker`. Verify Docker group or sudo access and re-run `compartment install` or `compartment system update`.'
    : 'Docker Engine and the Docker Compose plugin are installed, but this session cannot access the Docker daemon. Add this user to the docker group, configure passwordless sudo for Docker, or re-run `compartment install` or `compartment system update` in an interactive shell to allow `sudo docker`.';
}

export function readMissingDockerInstallMessage(canConfirmInstall: boolean): string {
  return canConfirmInstall
    ? 'Docker installation was skipped. Install Docker manually and re-run `compartment install` or `compartment system update`.'
    : 'Docker Engine with the Docker Compose plugin is required before self-hosted runtime management. Install Docker manually, or re-run `compartment install` or `compartment system update` in an interactive shell to approve Docker installation.';
}
