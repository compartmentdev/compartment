import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CompartmentRouteRule } from '@compartment/contracts';

export interface SelfHostedBuildVariableFixture {
  readonly key: string;
  readonly value: string;
}

export interface SelfHostedSingleServiceBuildFixture {
  readonly buildVariables?: readonly SelfHostedBuildVariableFixture[] | undefined;
  readonly directory: string;
  readonly expectedAuthorizedBodyText?: string | undefined;
  readonly expectedLogTexts?: readonly string[] | undefined;
  readonly expectedOrderedLogTexts?: readonly string[] | undefined;
  readonly expectedRuntimeCommand?: SelfHostedRuntimeCommandExpectation | undefined;
  readonly name: string;
  readonly unexpectedLogTexts?: readonly string[] | undefined;
}

export interface SelfHostedMultiServiceBuildFixture {
  readonly checkRollback?: boolean | undefined;
  readonly directory: string;
  readonly name: string;
  readonly proxyPayload: SelfHostedProxyReadyPayload;
  readonly routedServiceName: string;
  readonly routes: readonly CompartmentRouteRule[];
  readonly services: readonly SelfHostedMultiServiceFixtureService[];
}

export interface SelfHostedMultiServiceFixtureService {
  readonly logTexts: readonly string[];
  readonly name: string;
}

export interface SelfHostedProxyReadyPayload {
  readonly service: string;
  readonly status: string;
}

export interface SelfHostedRuntimeCommandExpectation {
  readonly command: readonly string[];
  readonly expectedText: string;
}

export const selfHostedStaticPoisonBuildFixtureName: string = 'static-poison';

export const selfHostedSingleServiceBuildFixtures: readonly SelfHostedSingleServiceBuildFixture[] = [
  {
    directory: resolve(__dirname, '../../../examples/dockerfile'),
    expectedAuthorizedBodyText: 'Dockerfile',
    expectedLogTexts: ['dockerfile release completed', 'dockerfile booting', 'dockerfile listening'],
    expectedOrderedLogTexts: ['dockerfile release completed', 'dockerfile booting'],
    name: 'dockerfile',
  },
  {
    directory: resolve(__dirname, '../../../examples/dockerfile-monorepo/apps/web'),
    expectedAuthorizedBodyText: 'shared from dockerfile monorepo include',
    expectedLogTexts: ['dockerfile-monorepo booting', 'dockerfile-monorepo listening'],
    name: 'dockerfile-monorepo',
  },
  {
    directory: resolve(__dirname, '../../../examples/railpack'),
    expectedAuthorizedBodyText: 'Railpack',
    expectedLogTexts: ['railpack release completed', 'railpack booting', 'railpack listening'],
    expectedOrderedLogTexts: ['railpack release completed', 'railpack booting'],
    name: 'railpack',
    unexpectedLogTexts: ['railpack default booting'],
  },
  {
    directory: resolve(__dirname, '../../../examples/railpack-build-packages'),
    expectedAuthorizedBodyText: 'railpack-build-packages',
    expectedLogTexts: ['railpack-build-packages booting', 'railpack-build-packages listening'],
    name: 'railpack-build-packages',
  },
  {
    directory: resolve(__dirname, '../../../examples/railpack-monorepo/apps/web'),
    expectedAuthorizedBodyText: 'shared from monorepo include',
    expectedLogTexts: ['railpack-monorepo booting', 'railpack-monorepo listening'],
    name: 'railpack-monorepo',
  },
  {
    directory: resolve(__dirname, '../../../examples/railpack-pnpm-workspace'),
    expectedAuthorizedBodyText: 'shared from pnpm workspace include',
    expectedLogTexts: ['railpack-pnpm-workspace booting', 'railpack-pnpm-workspace listening'],
    name: 'railpack-pnpm-workspace',
  },
  {
    directory: resolve(__dirname, '../../../examples/python'),
    expectedAuthorizedBodyText: 'Python',
    expectedLogTexts: ['python booting', 'python listening'],
    name: 'python',
  },
  {
    buildVariables: [
      {
        key: 'VITE_PUBLIC_GREETING',
        value: 'hello from compartment build env',
      },
    ],
    directory: resolve(__dirname, '../../../examples/vite-react'),
    expectedAuthorizedBodyText: 'hello from compartment build env',
    expectedLogTexts: ['vite-react booting', 'vite-react listening'],
    name: 'vite-react',
  },
  {
    buildVariables: [
      {
        key: 'VITE_PUBLIC_GREETING',
        value: 'hello from compartment static build env',
      },
    ],
    directory: resolve(__dirname, '../../../examples/static-vite-react'),
    expectedAuthorizedBodyText: 'hello from compartment static build env',
    name: 'static-vite-react',
  },
] as const;

export const selfHostedMultiServiceBuildFixtures: readonly SelfHostedMultiServiceBuildFixture[] = [
  {
    checkRollback: true,
    directory: resolve(__dirname, '../../../examples/multi-service'),
    name: 'multi-service',
    proxyPayload: {
      service: 'backoffice',
      status: 'ok',
    },
    routedServiceName: 'backoffice',
    routes: [
      {
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        to: 'backoffice',
      },
    ],
    services: [
      {
        logTexts: ['multi-service web booting', 'multi-service web listening'],
        name: 'web',
      },
      {
        logTexts: ['multi-service backoffice booting', 'multi-service backoffice listening'],
        name: 'backoffice',
      },
    ],
  },
  {
    directory: resolve(__dirname, '../../../examples/java-api-frontend'),
    name: 'java-api-frontend',
    proxyPayload: {
      service: 'api',
      status: 'ok',
    },
    routedServiceName: 'api',
    routes: [
      {
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        to: 'api',
      },
    ],
    services: [
      {
        logTexts: ['java-api-frontend web booting', 'java-api-frontend web listening'],
        name: 'web',
      },
      {
        logTexts: ['java-api-frontend api booting', 'java-api-frontend api listening'],
        name: 'api',
      },
    ],
  },
] as const;

export async function createSelfHostedStaticPoisonDockerfileFixture(
  tempRootDirectory: string,
): Promise<SelfHostedSingleServiceBuildFixture> {
  const fixtureDirectory: string = await mkdtemp(join(tempRootDirectory, 'static-poison-'));
  const sourceDirectory: string = resolve(__dirname, '../../../examples/static-vite-react');

  await cp(sourceDirectory, join(fixtureDirectory, 'public-docs'), { recursive: true });
  await writeFile(
    join(fixtureDirectory, 'package.json'),
    '{\n  "name": "static-poison-root",\n  "private": true,\n  "packageManager": "pnpm@10.6.3",\n  "workspaces": [\n    "public-docs"\n  ]\n}\n',
    'utf8',
  );
  await writeFile(join(fixtureDirectory, 'pnpm-workspace.yaml'), 'packages:\n  - public-docs\n', 'utf8');
  await writeFile(join(fixtureDirectory, 'compartment.yml'), staticPoisonDescriptor, 'utf8');
  await writeFile(join(fixtureDirectory, 'public-docs', 'Dockerfile'), staticPoisonDockerfile, 'utf8');

  return {
    buildVariables: [
      {
        key: 'VITE_PUBLIC_GREETING',
        value: 'hello from static poison fixture',
      },
    ],
    directory: fixtureDirectory,
    expectedAuthorizedBodyText: 'hello from static poison fixture',
    expectedRuntimeCommand: {
      command: ['jq', '--version'],
      expectedText: 'jq-',
    },
    name: selfHostedStaticPoisonBuildFixtureName,
    unexpectedLogTexts: ['temporary static fixture must not build through service-local Dockerfile autodetect'],
  };
}

const staticPoisonDescriptor: string = `name: static-poison

services:
  web:
    kind: static
    path: public-docs
    build:
      command: pnpm --dir public-docs exec node build.mjs
      include:
        - package.json
        - pnpm-workspace.yaml
      outputDirectory: dist
      env:
        - VITE_PUBLIC_GREETING
      packages:
        runtime:
          - jq
`;

const staticPoisonDockerfile: string = `FROM node:24-alpine

RUN echo "temporary static fixture must not build through service-local Dockerfile autodetect" >&2 && exit 1
`;
