import { preflightSelfHostedInstall } from '../../install';
import type { CliIo } from '../../app.types';
import {
  formatInstallPublicPortConflictMessage,
  InstallPublicPortOccupiedError,
  type InstallPublicPortLabel,
} from '../../install-public-port-preflight';
import type { InstallContext } from '../../install.types';
import { promptPort } from '../../prompts/prompt';
import type { CliCommandDependencies } from '../command.types';
import { resolveSelfHostedInstallPreflightOptions } from './install.command.execution';
import { defaultPublicHttpPort, defaultPublicHttpsPort, readInstallPublicPortOption } from './install.command.helpers';
import type { InstallVersionSelection } from './install.command.options';
import type { InstallCommandProgress } from './install.command.progress.types';
import type { InstallCommandOptions } from './install.command.types';

export interface InstallPublicPorts {
  publicHttpPort: number;
  publicHttpsPort: number;
}

interface InteractiveInstallPortPromptInput {
  isTTY: true;
  setRawMode(mode: boolean): InteractiveInstallPortPromptInput;
}

export function resolveInstallPublicPorts(options: InstallCommandOptions): InstallPublicPorts {
  return {
    publicHttpPort: readInstallPublicPortOption(options.publicHttpPort, 'Public HTTP port', defaultPublicHttpPort),
    publicHttpsPort: readInstallPublicPortOption(options.publicHttpsPort, 'Public HTTPS port', defaultPublicHttpsPort),
  };
}

export async function ensureInstallPublicPortsAvailable(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
  installContext: InstallContext,
  progress?: InstallCommandProgress,
): Promise<InstallPublicPorts> {
  let resolvedPublicPorts: InstallPublicPorts = publicPorts;

  for (;;) {
    const nextPublicPorts: InstallPublicPorts | null = await readNextAvailableInstallPublicPorts(
      dependencies,
      options,
      versionSelection,
      resolvedPublicPorts,
      installContext,
      progress,
    );
    if (nextPublicPorts === null) {
      return resolvedPublicPorts;
    }

    resolvedPublicPorts = nextPublicPorts;
  }
}

async function readNextAvailableInstallPublicPorts(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
  installContext: InstallContext,
  progress: InstallCommandProgress | undefined,
): Promise<InstallPublicPorts | null> {
  const error: InstallPublicPortOccupiedError | null = await readInstallPublicPortPreflightError(
    options,
    versionSelection,
    publicPorts,
    installContext,
  );
  return error === null
    ? null
    : await handleInstallPublicPortPreflightError(dependencies, publicPorts, error, progress);
}

async function readInstallPublicPortPreflightError(
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
  installContext: InstallContext,
): Promise<InstallPublicPortOccupiedError | null> {
  try {
    await preflightSelfHostedInstall({
      context: installContext,
      options: resolveSelfHostedInstallPreflightOptions(options, versionSelection, publicPorts),
    });
    return null;
  } catch (error) {
    if (error instanceof InstallPublicPortOccupiedError) {
      return error;
    }

    throw error;
  }
}

async function handleInstallPublicPortPreflightError(
  dependencies: CliCommandDependencies,
  publicPorts: InstallPublicPorts,
  error: InstallPublicPortOccupiedError,
  progress: InstallCommandProgress | undefined,
): Promise<InstallPublicPorts> {
  progress?.stop();
  dependencies.io.stderr(`${error.message}\n`);
  return await promptAvailableInstallPublicPort(dependencies, publicPorts, error.label);
}

async function promptAvailableInstallPublicPort(
  dependencies: CliCommandDependencies,
  publicPorts: InstallPublicPorts,
  label: InstallPublicPortLabel,
): Promise<InstallPublicPorts> {
  const promptedPort: number = await promptResolvedInstallPublicPort(dependencies, publicPorts, label);
  return updateInstallPublicPorts(publicPorts, label, promptedPort);
}

async function promptResolvedInstallPublicPort(
  dependencies: CliCommandDependencies,
  publicPorts: InstallPublicPorts,
  label: InstallPublicPortLabel,
): Promise<number> {
  if (label === 'Public HTTP port') {
    return await promptDistinctInstallPublicPort(
      dependencies,
      label,
      publicPorts.publicHttpPort,
      publicPorts.publicHttpsPort,
      'https',
    );
  }

  return await promptDistinctInstallPublicPort(
    dependencies,
    label,
    publicPorts.publicHttpsPort,
    publicPorts.publicHttpPort,
    'http',
  );
}

function updateInstallPublicPorts(
  publicPorts: InstallPublicPorts,
  label: InstallPublicPortLabel,
  promptedPort: number,
): InstallPublicPorts {
  if (label === 'Public HTTP port') {
    return {
      ...publicPorts,
      publicHttpPort: promptedPort,
    };
  }

  return {
    ...publicPorts,
    publicHttpsPort: promptedPort,
  };
}

async function promptDistinctInstallPublicPort(
  dependencies: CliCommandDependencies,
  label: InstallPublicPortLabel,
  defaultPort: number,
  otherPort: number,
  otherProtocol: 'http' | 'https',
): Promise<number> {
  for (;;) {
    const promptedPort: number = await promptPort(dependencies.io, label, defaultPort);
    if (shouldFailUnchangedNonInteractiveInstallPort(dependencies.io, promptedPort, defaultPort)) {
      throw createInstallPublicPortOccupiedRetryError(label, defaultPort);
    }
    if (promptedPort !== otherPort) {
      return promptedPort;
    }

    const publicHttpPort: number = otherProtocol === 'http' ? otherPort : promptedPort;
    const publicHttpsPort: number = otherProtocol === 'https' ? otherPort : promptedPort;
    dependencies.io.stderr(`${formatInstallPublicPortConflictMessage(publicHttpPort, publicHttpsPort)}\n`);
  }
}

function shouldFailUnchangedNonInteractiveInstallPort(io: CliIo, promptedPort: number, defaultPort: number): boolean {
  return !isInteractiveInstallPortPromptInput(io.stdin) && promptedPort === defaultPort;
}

function isInteractiveInstallPortPromptInput(input: NodeJS.ReadableStream): boolean {
  const ttyInput: Partial<InteractiveInstallPortPromptInput> = input as Partial<InteractiveInstallPortPromptInput>;
  return ttyInput.isTTY === true && typeof ttyInput.setRawMode === 'function';
}

function createInstallPublicPortOccupiedRetryError(
  label: InstallPublicPortLabel,
  port: number,
): InstallPublicPortOccupiedError {
  return new InstallPublicPortOccupiedError({
    label,
    optionName: readInstallPublicPortOptionName(label),
    port,
  });
}

function readInstallPublicPortOptionName(label: InstallPublicPortLabel): '--public-http-port' | '--public-https-port' {
  return label === 'Public HTTP port' ? '--public-http-port' : '--public-https-port';
}
