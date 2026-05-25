import {
  compartmentRouteRulesSchema,
  isRoutableCompartmentServiceKind,
  resolveCompartmentServiceKind,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredService,
  type CompartmentRouteRule,
  type CompartmentRoutesFile,
  type CompartmentServiceKind,
} from '@compartment/contracts';
import { createDescriptorServiceNotFoundError, createUnsupportedServiceKindError } from '../errors/api-business-error';

export function validateDescriptorRoutes(
  descriptor: CompartmentAuthoredDescriptor,
  routes: CompartmentRoutesFile | undefined,
): void {
  if (routes === undefined) {
    return;
  }

  for (const route of routes.routes) {
    requireRoutableDescriptorService(descriptor, route.on);
    requireRoutableDescriptorService(descriptor, route.to);
  }
}

export function filterSourceCompartmentRoutes(
  routes: CompartmentRoutesFile | undefined,
  sourceServiceName: string,
): CompartmentRouteRule[] {
  if (routes === undefined) {
    return [];
  }

  return routes.routes.filter((route: CompartmentRouteRule): boolean => route.on === sourceServiceName);
}

export function serializeCompartmentRoutes(routes: CompartmentRouteRule[]): string {
  return JSON.stringify(routes);
}

export function parseSerializedCompartmentRoutes(serializedRoutes: string): CompartmentRouteRule[] {
  return compartmentRouteRulesSchema.parse(JSON.parse(serializedRoutes));
}

function requireRoutableDescriptorService(descriptor: CompartmentAuthoredDescriptor, serviceName: string): void {
  const service: CompartmentAuthoredService | undefined = descriptor.services[serviceName];
  if (service === undefined) {
    throw createDescriptorServiceNotFoundError();
  }
  if (!isRoutableCompartmentServiceKind(resolveAuthoredServiceKind(service))) {
    throw createUnsupportedServiceKindError();
  }
}

function resolveAuthoredServiceKind(service: CompartmentAuthoredService): CompartmentServiceKind {
  if (typeof service === 'string') {
    return resolveCompartmentServiceKind(undefined);
  }

  return resolveCompartmentServiceKind(service.kind);
}
