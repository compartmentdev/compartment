export interface CompartmentDescriptorRelatedFile {
  fileName: string;
  purpose: string;
}

export const compartmentDescriptorFileName: string = 'compartment.yml';
export const compartmentDescriptorLocation: string = 'current directory';
export const compartmentDescriptorMinimalExampleYaml: string = `name: <project-slug>

services:
  web: .`;
export const compartmentDescriptorExpandedExampleYaml: string = `name: internal-tools

services:
  site:
    accessMode: public
    kind: static
    path: apps/site
    build:
      command: pnpm build
      outputDirectory: dist
      env:
        - PUBLIC_API_BASE_URL

  web:
    accessMode: public
    path: apps/web
    build:
      # If include widens a source build, Railpack detects and installs from the widened root.
      # Include the package manager, lockfile, and workspace files that root build expects.
      strategy: railpack
      command: pnpm --filter @internal-tools/web build
      include:
        - package.json
        - pnpm-lock.yaml
        - pnpm-workspace.yaml
        - packages/shared-ui
      env:
        - VITE_PUBLIC_API_URL
      packages:
        build:
          - build-essential
        runtime:
          - libnss3
    run:
      command: pnpm --filter @internal-tools/web start
    readiness:
      type: http
      path: /ready
      timeoutMs: 10000

  api:
    path: apps/api
    kind: api
    connections:
      db:
        env:
          DATABASE_URL: connection-url

  worker:
    path: apps/worker
    kind: worker

resources:
  db:
    preset: postgres
    env:
      POSTGRES_DB: app`;
export const compartmentDescriptorOwns: readonly string[] = [
  'the repo-to-project slug link',
  'deployable service names',
  'hosted app access hints',
  'service-relative paths',
  'service build hints',
  'static build-output hints',
  'extra source-package include paths',
  'service kind hints',
  'service runtime-start hints',
  'service release commands',
  'service runtime variable references to resource outputs',
  'readiness hints',
  'resource generated-variable intent',
  'resource images, env, ports, volumes, readiness, outputs, and backup/restore operation intent',
];
export const compartmentDescriptorDoesNotOwn: readonly string[] = [
  'service runtime variable plaintext, secrets, and environment-specific runtime values',
  'hosted domains',
  'deployment history',
  'browser-facing proxy rules',
  'resource secret/plaintext values, public ingress, backup records, backup artifacts, or restore state',
];
export const compartmentDescriptorRelatedFiles: readonly CompartmentDescriptorRelatedFile[] = [
  {
    fileName: 'compartment.routes.yml',
    purpose: 'Browser-facing rewrites and proxy rules.',
  },
];
