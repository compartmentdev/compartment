import type { NodeRegistrationRequest, NodeRegistrationResponse } from '@compartment/contracts';
import type { NodeConfig } from '../config';
import type { RegisterNode } from './registration-api.types';

const INITIAL_REGISTRATION_MAX_ATTEMPTS: number = 20;
const INITIAL_REGISTRATION_RETRY_DELAY_MS: number = 500;

interface StartupRegistrationErrorCause {
  code?: string | undefined;
}

interface StartupRegistrationLogPayload {
  attempt: number;
  maxAttempts: number;
}

interface StartupRegistrationLogger {
  warn(payload: StartupRegistrationLogPayload, message: string): void;
}

type WaitForRetry = (delayMs: number) => Promise<void>;

export async function registerNodeOnStartup(
  registerNode: RegisterNode,
  config: NodeConfig,
  logger: StartupRegistrationLogger,
  waitForRetry: WaitForRetry = waitForRetryDelay,
): Promise<NodeRegistrationResponse> {
  for (let attempt: number = 1; attempt <= INITIAL_REGISTRATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await registerNode(createRegistrationPayload(config));
    } catch (error) {
      const registrationError: Error = error instanceof Error ? error : new Error('Node registration failed.');

      await handleStartupRegistrationError(registrationError, attempt, logger, waitForRetry);
    }
  }

  throw new Error('Node registration exhausted all startup retry attempts.');
}

function createRegistrationPayload(config: NodeConfig): NodeRegistrationRequest {
  return {
    nodeSocketPath: config.nodeSocketPath,
    nodeName: config.name,
    nodeVersion: config.version,
  };
}

async function handleStartupRegistrationError(
  error: Error,
  attempt: number,
  logger: StartupRegistrationLogger,
  waitForRetry: WaitForRetry,
): Promise<void> {
  if (!isRetryableStartupRegistrationError(error) || attempt === INITIAL_REGISTRATION_MAX_ATTEMPTS) {
    throw error;
  }

  logger.warn(
    { attempt, maxAttempts: INITIAL_REGISTRATION_MAX_ATTEMPTS },
    'API is not ready yet. Retrying node registration.',
  );
  await waitForRetry(INITIAL_REGISTRATION_RETRY_DELAY_MS);
}

function isRetryableStartupRegistrationError(error: Error): boolean {
  return readErrorCode(error) === 'ECONNREFUSED';
}

function readErrorCode(error: Error): string | null {
  const cause: StartupRegistrationErrorCause | null | undefined = (
    error as Error & { cause?: StartupRegistrationErrorCause | null }
  ).cause;

  if (cause === null || typeof cause !== 'object' || !('code' in cause)) {
    return null;
  }

  return typeof cause.code === 'string' ? cause.code : null;
}

async function waitForRetryDelay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, delayMs);
  });
}
