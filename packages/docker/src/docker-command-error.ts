interface DockerCommandError extends Error {
  stderr?: string | undefined;
}

export function readDockerCommandErrorText(error: Error | null | undefined): string | null {
  if (error === null || error === undefined) {
    return null;
  }

  const dockerError: DockerCommandError = error;
  const stderr: string = typeof dockerError.stderr === 'string' ? dockerError.stderr : '';
  const message: string = typeof dockerError.message === 'string' ? dockerError.message : '';

  return `${message}\n${stderr}`.toLowerCase();
}
