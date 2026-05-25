import { z } from 'zod';
import { buildCompartmentArtifactRegistryAddress } from '@compartment/utils';
import type { DockerRegistryCredentials } from '@compartment/docker';
import { assertValidNodeAgentSocketPath } from './node-agent-socket-path';
import type { RuntimeConnectivityMode } from './services/runtime.types';

interface NodeConfigEnvironment {
  COMPARTMENT_API_URL: string;
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: string;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: string;
  COMPARTMENT_NODE_APP_PORT_END: number;
  COMPARTMENT_NODE_APP_PORT_START: number;
  COMPARTMENT_DOCKER_NAMESPACE: string;
  COMPARTMENT_NODE_NAME: string;
  COMPARTMENT_NODE_AGENT_SOCKET: string;
  COMPARTMENT_NODE_VERSION: string;
  COMPARTMENT_LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  COMPARTMENT_RUNTIME_CONNECTIVITY_MODE: RuntimeConnectivityMode;
  COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: string;
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: string;
  COMPARTMENT_RUNTIME_PROBE_IMAGE: string;
}

type NodeConfigSchemaShape = z.ZodRawShape & {
  COMPARTMENT_API_URL: z.ZodString;
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: z.ZodString;
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: z.ZodNumber;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: z.ZodString;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: z.ZodString;
  COMPARTMENT_DOCKER_NAMESPACE: z.ZodString;
  COMPARTMENT_LOG_LEVEL: z.ZodEnum<['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']>;
  COMPARTMENT_NODE_APP_PORT_END: z.ZodNumber;
  COMPARTMENT_NODE_APP_PORT_START: z.ZodNumber;
  COMPARTMENT_NODE_AGENT_SOCKET: z.ZodString;
  COMPARTMENT_NODE_NAME: z.ZodString;
  COMPARTMENT_NODE_VERSION: z.ZodString;
  COMPARTMENT_RUNTIME_CONNECTIVITY_MODE: z.ZodEnum<['loopback', 'network']>;
  COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: z.ZodString;
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: z.ZodString;
  COMPARTMENT_RUNTIME_PROBE_IMAGE: z.ZodString;
};

export interface NodeConfig {
  apiUrl: string;
  appPortEnd: number;
  appPortStart: number;
  dockerNamespace: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  name: string;
  nodeSocketPath: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
  runtimeDefaultUpstreamHost: string;
  runtimeRegistryCredentials: DockerRegistryCredentials;
  runtimeProbeImageRef: string;
  version: string;
  runtimeControlToken: string;
}

export function readNodeConfig(env: NodeJS.ProcessEnv = process.env): NodeConfig {
  const parsed: NodeConfigEnvironment = parseNodeConfigEnvironment(env);
  assertValidNodeAgentSocketPath(parsed.COMPARTMENT_NODE_AGENT_SOCKET);

  return {
    apiUrl: parsed.COMPARTMENT_API_URL,
    appPortEnd: parsed.COMPARTMENT_NODE_APP_PORT_END,
    appPortStart: parsed.COMPARTMENT_NODE_APP_PORT_START,
    dockerNamespace: parsed.COMPARTMENT_DOCKER_NAMESPACE,
    logLevel: parsed.COMPARTMENT_LOG_LEVEL,
    name: parsed.COMPARTMENT_NODE_NAME,
    nodeSocketPath: parsed.COMPARTMENT_NODE_AGENT_SOCKET,
    runtimeConnectivityMode: parsed.COMPARTMENT_RUNTIME_CONNECTIVITY_MODE,
    runtimeDefaultUpstreamHost: parsed.COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST,
    runtimeRegistryCredentials: readRuntimeRegistryCredentials(parsed),
    runtimeProbeImageRef: parsed.COMPARTMENT_RUNTIME_PROBE_IMAGE,
    version: parsed.COMPARTMENT_NODE_VERSION,
    runtimeControlToken: parsed.COMPARTMENT_RUNTIME_CONTROL_TOKEN,
  };
}

function readRuntimeRegistryCredentials(parsed: NodeConfigEnvironment): DockerRegistryCredentials {
  return {
    password: parsed.COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD,
    serverAddress: buildCompartmentArtifactRegistryAddress(
      parsed.COMPARTMENT_ARTIFACT_REGISTRY_HOST,
      parsed.COMPARTMENT_ARTIFACT_REGISTRY_PORT,
    ),
    username: parsed.COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME,
  };
}

function parseNodeConfigEnvironment(env: NodeJS.ProcessEnv): NodeConfigEnvironment {
  return createNodeConfigSchema().parse(env) as NodeConfigEnvironment;
}

function createNodeConfigSchema(): z.ZodObject<NodeConfigSchemaShape> {
  return z.object(readNodeConfigSchemaShape());
}

function readNodeConfigSchemaShape(): NodeConfigSchemaShape {
  return {
    COMPARTMENT_API_URL: z.string().url(),
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: z.string().min(1),
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: z.coerce.number().int().positive(),
    COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: z.string().min(1),
    COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: z.string().min(1),
    COMPARTMENT_DOCKER_NAMESPACE: z.string().min(1),
    COMPARTMENT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    COMPARTMENT_NODE_APP_PORT_END: z.coerce.number().int().positive(),
    COMPARTMENT_NODE_APP_PORT_START: z.coerce.number().int().positive(),
    COMPARTMENT_NODE_AGENT_SOCKET: z.string().min(1),
    COMPARTMENT_NODE_NAME: z.string().min(1),
    COMPARTMENT_NODE_VERSION: z.string().min(1),
    COMPARTMENT_RUNTIME_CONNECTIVITY_MODE: z.enum(['loopback', 'network']),
    COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: z.string().min(1),
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: z.string().min(1),
    COMPARTMENT_RUNTIME_PROBE_IMAGE: z.string().min(1),
  };
}
