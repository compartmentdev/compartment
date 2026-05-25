import { compartmentDescriptorFileName } from './compartment-descriptor-guide.contract';

type CompartmentRoutePathFormValues = readonly ['exact_path', 'prefix_path'];
type CompartmentRouteTransformFieldValues = readonly ['replacePrefix', 'rewrite', 'stripPrefix'];

export const compartmentRoutesFileName: string = 'compartment.routes.yml';
export const compartmentRoutesLocation: string = 'current directory';
export const compartmentRoutePathFormValues: CompartmentRoutePathFormValues = ['exact_path', 'prefix_path'];
export const compartmentRouteTransformFieldValues: CompartmentRouteTransformFieldValues = [
  'replacePrefix',
  'rewrite',
  'stripPrefix',
];
export const compartmentRoutePathMustStartWithSlashMessage: string = 'Path must start with /.';
export const compartmentRouteConcreteTransformMessage: string =
  'Transform paths must be concrete upstream paths and must not end with /*.';
export const compartmentRouteSingleTransformMessage: string =
  'Only one of rewrite, stripPrefix, or replacePrefix may be set.';
export const compartmentRoutePrefixTransformMessage: string =
  'stripPrefix and replacePrefix require a prefix path ending with /*.';
export const compartmentRouteStripPrefixMessage: string = 'stripPrefix must exactly match the route path prefix.';
export const compartmentRoutesExampleYaml: string = `version: 1

routes:
  - on: web
    path: /api/*
    to: api
    stripPrefix: /api

  - on: web
    path: /health
    to: api
    rewrite: /ready`;
export const compartmentRoutesValidationNotes: readonly string[] = [
  'version must be 1',
  'routes must be a non-empty array',
  'every path must start with /',
  compartmentRouteConcreteTransformMessage,
  compartmentRouteSingleTransformMessage,
  compartmentRoutePrefixTransformMessage,
  compartmentRouteStripPrefixMessage,
  `on and to must exist in ${compartmentDescriptorFileName}`,
  'only web, api, and static services are currently routable as on or to',
];
export const compartmentRoutesMatchingSemantics: readonly string[] = [
  'rules are evaluated in file order',
  'first match wins',
  'incoming request paths are matched against the raw forwarded path after rejecting ambiguous dot-segments and encoded or literal path separators',
  'exact paths match exactly',
  'prefix paths ending with /* match either the prefix itself or any deeper path',
  'method filtering runs before path rewriting',
  'query strings are preserved when a rule rewrites the path',
  'when a rule matches, Compartment checks access for both the source route and the target service route before proxying',
  'a public source route that proxies to an authenticated target still requires login on the source app route and app.route.access for the target route scope',
];
export const compartmentRoutesTransformSemantics: readonly string[] = [
  'rewrite replaces the entire upstream path',
  'stripPrefix removes the matched prefix',
  'replacePrefix swaps the matched prefix for a new prefix',
  'when no transform is set, the original safe request path is forwarded unchanged',
];
export const compartmentRoutesRelatedFiles: readonly string[] = [compartmentDescriptorFileName];
