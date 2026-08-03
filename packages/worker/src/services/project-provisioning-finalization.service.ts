import type { KubeJobResult } from '@compartment/kube-runtime';
import type { ProjectProvisioningResult } from './project-provisioning-execution.service.types';

export function failedProjectProvisioningCompletion(message: string): ProjectProvisioningResult {
  return { message, status: 'failed' };
}

export function projectProvisioningCompletion(result: KubeJobResult): ProjectProvisioningResult {
  if (result.status === 'succeeded') {
    return { status: 'succeeded' };
  }
  return {
    message: result.logs.trim() !== '' ? result.logs.trim() : `Project provisioning Job ${result.status}.`,
    status: 'failed',
  };
}

export async function finalizeProjectProvisioningJob(
  result: KubeJobResult,
  cleanupAuthority: () => Promise<object>,
): Promise<void> {
  const finalizationError: Error | null = await captureFinalizationError(result);
  try {
    await cleanupAuthority();
  } catch (error) {
    const cleanupError: Error = readError(typeof error === 'object' ? error : null);
    if (finalizationError !== null) {
      throw new AggregateError(
        [finalizationError, cleanupError],
        'Project provisioning Job finalization and authority cleanup both failed.',
      );
    }
    throw cleanupError;
  }
  if (finalizationError !== null) {
    throw finalizationError;
  }
}

async function captureFinalizationError(result: KubeJobResult): Promise<Error | null> {
  try {
    await result.finalize();
    return null;
  } catch (error) {
    return readError(typeof error === 'object' ? error : null);
  }
}

function readError(error: object | null): Error {
  return error instanceof Error ? error : new Error('Project provisioning Job finalization failed.');
}
