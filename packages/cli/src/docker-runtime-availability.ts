import type { SystemServiceName } from '@compartment/contracts';
import { inspectSelfHostedComposeRuntimeServices } from './docker-runtime.inspect';
import { selfHostedCoreRuntimeServiceNames } from './docker-runtime.service-names';
import type {
  DockerExecutionContext,
  SelfHostedRuntimeServiceInspection,
  StartSelfHostedRuntimeInput,
} from './docker-runtime.types';

export async function areCoreRuntimeServicesAvailable(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
): Promise<boolean> {
  return await areSelfHostedRuntimeServicesAvailable(context, input, selfHostedCoreRuntimeServiceNames);
}

export async function areSelfHostedRuntimeServicesAvailable(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  serviceNames: readonly SystemServiceName[],
): Promise<boolean> {
  const inspections: SelfHostedRuntimeServiceInspection[] = await inspectSelfHostedComposeRuntimeServices(
    context,
    input,
  );
  return serviceNames.every((serviceName: SystemServiceName): boolean => {
    const service: SelfHostedRuntimeServiceInspection | undefined = inspections.find(
      (inspection: SelfHostedRuntimeServiceInspection): boolean => inspection.name === serviceName,
    );

    return service?.status === 'running' && (service.health === null || service.health === 'healthy');
  });
}
