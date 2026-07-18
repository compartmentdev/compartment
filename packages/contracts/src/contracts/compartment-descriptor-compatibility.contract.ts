import type {
  CompartmentAuthoredDescriptor,
  CompartmentAuthoredResourceConfig,
  CompartmentAuthoredService,
  CompartmentAuthoredServiceConfig,
} from './compartment-descriptor.types';
import type {
  CompartmentDeprecatedRestartPolicy,
  CompartmentDeprecatedServiceRestartConfig,
} from './service-run.contract';

export interface CompartmentDescriptorCompatibilityWarning {
  message: string;
  path: string;
  value: string;
}

const kubernetesRestartBehaviorPrefix: string =
  'Kubernetes Deployment Pods use restartPolicy Always while the Deployment is running;';

export function readCompartmentDescriptorCompatibilityWarnings(
  descriptor: CompartmentAuthoredDescriptor,
): CompartmentDescriptorCompatibilityWarning[] {
  return [...readServiceRestartWarnings(descriptor), ...readResourceRestartWarnings(descriptor)];
}

function readServiceRestartWarnings(
  descriptor: CompartmentAuthoredDescriptor,
): CompartmentDescriptorCompatibilityWarning[] {
  return Object.entries(descriptor.services).flatMap(
    ([serviceName, service]: [string, CompartmentAuthoredService]): CompartmentDescriptorCompatibilityWarning[] => {
      if (typeof service === 'string') {
        return [];
      }

      return readServiceRestartWarning(serviceName, service);
    },
  );
}

function readServiceRestartWarning(
  serviceName: string,
  service: CompartmentAuthoredServiceConfig,
): CompartmentDescriptorCompatibilityWarning[] {
  const restart: CompartmentDeprecatedServiceRestartConfig | undefined = service.run?.restart;
  if (restart === undefined) {
    return [];
  }

  return [
    createRestartWarning(
      `services.${serviceName}.run.restart`,
      restart,
      'compartment project stop scales service Deployments to zero.',
    ),
  ];
}

function readResourceRestartWarnings(
  descriptor: CompartmentAuthoredDescriptor,
): CompartmentDescriptorCompatibilityWarning[] {
  return Object.entries(descriptor.resources ?? {}).flatMap(
    ([resourceName, resource]: [
      string,
      CompartmentAuthoredResourceConfig,
    ]): CompartmentDescriptorCompatibilityWarning[] => {
      if (resource.restart === undefined) {
        return [];
      }

      const policy: CompartmentDeprecatedRestartPolicy = resource.restart.policy ?? 'unless-stopped';
      return [
        createRestartWarning(
          `resources.${resourceName}.restart`,
          { policy },
          `compartment resource stop --resource ${resourceName} scales this resource Deployment to zero.`,
        ),
      ];
    },
  );
}

function createRestartWarning(
  path: string,
  restart: CompartmentDeprecatedServiceRestartConfig,
  stopBehavior: string,
): CompartmentDescriptorCompatibilityWarning {
  const value: string = JSON.stringify(restart);
  return {
    message: `Warning: deprecated ${path}=${value} is accepted for Docker-line compatibility but is not applied on Kubernetes. ${kubernetesRestartBehaviorPrefix} ${stopBehavior}`,
    path,
    value,
  };
}
