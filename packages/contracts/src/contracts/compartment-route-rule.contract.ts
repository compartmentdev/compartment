import { z } from 'zod';
import { compartmentServiceNameSchema } from './compartment-descriptor.contract';
import {
  compartmentRouteConcreteTransformMessage,
  compartmentRoutePathMustStartWithSlashMessage,
  compartmentRoutePrefixTransformMessage,
  compartmentRouteSingleTransformMessage,
  compartmentRouteStripPrefixMessage,
  compartmentRouteTransformFieldValues,
} from './compartment-routes-guide.contract';

export type CompartmentRouteMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';
export type CompartmentRoutePathForm = 'exact_path' | 'prefix_path';
export type CompartmentRouteTransformField = 'replacePrefix' | 'rewrite' | 'stripPrefix';

export interface CompartmentRouteRule {
  methods?: CompartmentRouteMethod[] | undefined;
  on: string;
  path: string;
  replacePrefix?: string | undefined;
  rewrite?: string | undefined;
  stripPrefix?: string | undefined;
  to: string;
}

export interface CompartmentRouteRequestPath {
  pathname: string;
  search: string;
}

export interface CompartmentRouteMatch<TRoute extends CompartmentRouteRule> {
  proxyPath: string;
  route: TRoute;
}

export const compartmentRouteMethodValues: readonly [
  CompartmentRouteMethod,
  CompartmentRouteMethod,
  CompartmentRouteMethod,
  CompartmentRouteMethod,
  CompartmentRouteMethod,
  CompartmentRouteMethod,
  CompartmentRouteMethod,
] = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];

const compartmentRouteMethodSchema: z.ZodType<CompartmentRouteMethod, z.ZodTypeDef, CompartmentRouteMethod> =
  z.enum(compartmentRouteMethodValues);

const compartmentRoutePathSchema: z.ZodType<string, z.ZodTypeDef, string> = z
  .string()
  .min(1)
  .refine((value: string): boolean => value.startsWith('/'), {
    message: compartmentRoutePathMustStartWithSlashMessage,
  });

const compartmentRouteTransformPathSchema: z.ZodType<string, z.ZodTypeDef, string> = compartmentRoutePathSchema.refine(
  (value: string): boolean => !isCompartmentRoutePrefixPath(value),
  {
    message: compartmentRouteConcreteTransformMessage,
  },
);

export function createCompartmentRouteRuleShape(): {
  methods: z.ZodOptional<z.ZodArray<typeof compartmentRouteMethodSchema, 'many'>>;
  on: typeof compartmentServiceNameSchema;
  path: typeof compartmentRoutePathSchema;
  replacePrefix: z.ZodOptional<typeof compartmentRouteTransformPathSchema>;
  rewrite: z.ZodOptional<typeof compartmentRouteTransformPathSchema>;
  stripPrefix: z.ZodOptional<typeof compartmentRouteTransformPathSchema>;
  to: typeof compartmentServiceNameSchema;
} {
  return {
    on: compartmentServiceNameSchema,
    path: compartmentRoutePathSchema,
    to: compartmentServiceNameSchema,
    methods: z.array(compartmentRouteMethodSchema).min(1).optional(),
    stripPrefix: compartmentRouteTransformPathSchema.optional(),
    replacePrefix: compartmentRouteTransformPathSchema.optional(),
    rewrite: compartmentRouteTransformPathSchema.optional(),
  };
}

export function validateCompartmentRouteRule(rule: CompartmentRouteRule, context: z.RefinementCtx): void {
  validateRouteTransformCount(rule, context);
  validateRoutePrefixTransformUsage(rule, context);
}

function validateRouteTransformCount(rule: CompartmentRouteRule, context: z.RefinementCtx): void {
  if (countRouteTransforms(rule) > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: compartmentRouteSingleTransformMessage,
      path: ['rewrite'],
    });
  }
}

function validateRoutePrefixTransformUsage(rule: CompartmentRouteRule, context: z.RefinementCtx): void {
  const isPrefixPath: boolean = isCompartmentRoutePrefixPath(rule.path);
  const routePrefix: string | null = readCompartmentRoutePrefix(rule.path);

  if (!isPrefixPath && (rule.stripPrefix !== undefined || rule.replacePrefix !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: compartmentRoutePrefixTransformMessage,
      path: ['path'],
    });
  }
  if (rule.stripPrefix !== undefined && routePrefix !== null && rule.stripPrefix !== routePrefix) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: compartmentRouteStripPrefixMessage,
      path: ['stripPrefix'],
    });
  }
}

export function matchCompartmentRoute<TRoute extends CompartmentRouteRule>(
  routes: readonly TRoute[],
  method: string,
  requestPath: CompartmentRouteRequestPath,
): CompartmentRouteMatch<TRoute> | null {
  const normalizedMethod: string = method.toUpperCase();

  for (const route of routes) {
    if (!matchesCompartmentRouteMethod(route, normalizedMethod)) {
      continue;
    }

    const proxyPath: string | null = readCompartmentRouteProxyPath(route, requestPath);
    if (proxyPath === null) {
      continue;
    }

    return {
      proxyPath,
      route,
    };
  }

  return null;
}

function countRouteTransforms(rule: CompartmentRouteRule): number {
  return compartmentRouteTransformFieldValues.filter(
    (fieldName: CompartmentRouteTransformField): boolean => rule[fieldName] !== undefined,
  ).length;
}

function matchesCompartmentRouteMethod(route: CompartmentRouteRule, method: string): boolean {
  return (
    route.methods === undefined || route.methods.some((candidateMethod: string): boolean => candidateMethod === method)
  );
}

function readCompartmentRouteProxyPath(
  route: CompartmentRouteRule,
  requestPath: CompartmentRouteRequestPath,
): string | null {
  if (!matchesCompartmentRoutePath(route, requestPath.pathname)) {
    return null;
  }

  return `${readCompartmentRouteProxyPathname(route, requestPath.pathname)}${requestPath.search}`;
}

function matchesCompartmentRoutePath(route: CompartmentRouteRule, pathname: string): boolean {
  if (!isCompartmentRoutePrefixPath(route.path)) {
    return pathname === route.path;
  }

  const routePrefix: string = requireCompartmentRoutePrefix(route.path);
  if (routePrefix === '/') {
    return pathname.startsWith('/');
  }

  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

function readCompartmentRouteProxyPathname(route: CompartmentRouteRule, pathname: string): string {
  if (route.rewrite !== undefined) {
    return route.rewrite;
  }
  if (!isCompartmentRoutePrefixPath(route.path)) {
    return pathname;
  }

  const routePrefix: string = requireCompartmentRoutePrefix(route.path);
  const routeSuffix: string = readCompartmentRouteSuffix(routePrefix, pathname);
  if (route.stripPrefix !== undefined) {
    return routeSuffix === '' ? '/' : routeSuffix;
  }
  if (route.replacePrefix !== undefined) {
    return joinCompartmentRouteProxyPath(route.replacePrefix, routeSuffix);
  }

  return pathname;
}

function requireCompartmentRoutePrefix(path: string): string {
  const routePrefix: string | null = readCompartmentRoutePrefix(path);
  if (routePrefix === null) {
    throw new Error(`Expected prefix route path, got ${path}.`);
  }

  return routePrefix;
}

function readCompartmentRouteSuffix(routePrefix: string, pathname: string): string {
  if (pathname === routePrefix) {
    return '';
  }
  if (routePrefix === '/') {
    return pathname;
  }

  return pathname.slice(routePrefix.length);
}

function joinCompartmentRouteProxyPath(prefix: string, suffix: string): string {
  if (prefix === '/') {
    return suffix === '' ? '/' : suffix;
  }
  if (suffix !== '' && prefix.endsWith('/')) {
    return `${prefix.slice(0, -1)}${suffix}`;
  }

  return suffix === '' ? prefix : `${prefix}${suffix}`;
}

function readCompartmentRoutePrefix(path: string): string | null {
  if (!isCompartmentRoutePrefixPath(path)) {
    return null;
  }

  const prefix: string = path.slice(0, -2);
  return prefix === '' ? '/' : prefix;
}

function isCompartmentRoutePrefixPath(path: string): boolean {
  return path.endsWith('/*');
}
