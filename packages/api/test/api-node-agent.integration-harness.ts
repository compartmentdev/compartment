import { mkdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import {
  buildCompartmentResourceHostname,
  nodeDeployPathname,
  nodeDeployRequestSchema,
  nodeDrainDeploymentPathname,
  nodeDrainDeploymentRequestSchema,
  nodeInspectDeploymentPathname,
  nodeInspectDeploymentQuerySchema,
  nodeProjectCleanupPathname,
  nodeProjectCleanupRequestSchema,
  nodeResourceDeletePathname,
  nodeResourceDeleteRequestSchema,
  nodeResourceLogsPathname,
  nodeResourceLogsQuerySchema,
  nodeResourceOperationBackupPathname,
  nodeResourceOperationRequestSchema,
  nodeResourceOperationRestorePathname,
  nodeResourceReconcilePathname,
  nodeResourceRequestSchema,
  nodeResourceRestartPolicyPathname,
  nodeResourceRestartPolicyRequestSchema,
  nodeResourceStartPathname,
  nodeResourceStopPathname,
  nodeResourceStopRequestSchema,
  nodeStopDeploymentPathname,
  nodeStopDeploymentRequestSchema,
  nodeTailLogsPathname,
  nodeTailLogsQuerySchema,
  type NodeDeployRequest,
  type NodeInspectDeploymentQuery,
  type NodeProjectCleanupRequest,
  type NodeResourceDeleteRequest,
  type NodeResourceLogsQuery,
  type NodeResourceRequest,
  type NodeResourceRestartPolicyRequest,
  type NodeResourceStopRequest,
  type NodeTailLogsQuery,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';

export const integrationNodeSocketPath: string = '/tmp/compartment/api-test/node/integration.sock';

interface IntegrationNodeAgentRequestContext {
  authorization: string | undefined;
  body: string;
  method: string;
  url: URL;
}

interface IntegrationNodeAgentRecordedRequest {
  body: string;
  method: string;
  pathname: string;
  search: string;
}

interface IntegrationNodeAgentResponse {
  body: JsonValue;
  status: number;
}

type IntegrationNodeAgentResponder = (
  context: IntegrationNodeAgentRequestContext,
) => IntegrationNodeAgentResponse | Promise<IntegrationNodeAgentResponse>;

const nodeAgentRequestBaseUrl: string = 'http://compartment-node-agent';
const integrationNodeAgentAuthorization: string = 'Bearer test-runtime-control-token';
const integrationNodeAgentRequests: IntegrationNodeAgentRecordedRequest[] = [];
const integrationNodeAgentResponders: IntegrationNodeAgentResponder[] = [];
const integrationNodeAgentHarnessErrors: Error[] = [];
let integrationNodeAgentServerPromise: Promise<Server> | null = null;

export function queueIntegrationNodeAgentResponse(body: JsonValue, status: number = 200): void {
  integrationNodeAgentResponders.push((): IntegrationNodeAgentResponse => ({ body, status }));
}

export function queueIntegrationNodeAgentError(message: string, status: number = 500): void {
  queueIntegrationNodeAgentResponse({ error: { code: 'node_agent_test_error', message } }, status);
}

export function clearIntegrationNodeAgentRequests(): void {
  integrationNodeAgentRequests.length = 0;
}

export function readIntegrationNodeAgentRequests(): IntegrationNodeAgentRecordedRequest[] {
  return [...integrationNodeAgentRequests];
}

export function readIntegrationNodeAgentRequestBody(callIndex: number): string {
  const request: IntegrationNodeAgentRecordedRequest | undefined = integrationNodeAgentRequests[callIndex];
  if (request === undefined) {
    throw new Error(`Expected node agent request at index ${callIndex}.`);
  }

  return request.body;
}

export async function ensureIntegrationNodeAgent(): Promise<void> {
  integrationNodeAgentServerPromise ??= startIntegrationNodeAgent();
  await integrationNodeAgentServerPromise;
}

export function resetIntegrationNodeAgentState(): void {
  assertNoIntegrationNodeAgentHarnessErrors();
  integrationNodeAgentRequests.length = 0;
  integrationNodeAgentResponders.length = 0;
}

export function assertNoIntegrationNodeAgentHarnessErrors(): void {
  const errors: Error[] = [...integrationNodeAgentHarnessErrors];
  integrationNodeAgentHarnessErrors.length = 0;
  if (errors.length === 0) {
    return;
  }

  throw new Error(errors.map((error: Error): string => error.message).join('\n'));
}

async function startIntegrationNodeAgent(): Promise<Server> {
  await mkdir(dirname(integrationNodeSocketPath), { recursive: true });
  await rm(integrationNodeSocketPath, { force: true });

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    void handleIntegrationNodeAgentRequest(request, response);
  });
  await listenOnSocket(server, integrationNodeSocketPath);
  server.unref();

  return server;
}

async function handleIntegrationNodeAgentRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const context: IntegrationNodeAgentRequestContext = {
      authorization: request.headers.authorization,
      body: await readRequestBody(request),
      method: request.method ?? 'GET',
      url: parseNodeAgentRequestUrl(request.url ?? '/'),
    };
    assertNodeAgentAuthorization(context);
    assertKnownNodeAgentRequest(context);
    integrationNodeAgentRequests.push({
      body: context.body,
      method: context.method,
      pathname: context.url.pathname,
      search: context.url.search,
    });

    const responder: IntegrationNodeAgentResponder | undefined = integrationNodeAgentResponders.shift();
    if (responder !== undefined) {
      writeIntegrationNodeAgentResponse(response, await responder(context));
      return;
    }

    writeDefaultNodeAgentResponse(context, response);
  } catch (error) {
    const message: string = error instanceof Error ? error.message : 'Unknown node agent test error.';
    integrationNodeAgentHarnessErrors.push(new Error(message));
    writeJsonResponse(response, 500, { error: { message } });
  }
}

function writeIntegrationNodeAgentResponse(response: ServerResponse, payload: IntegrationNodeAgentResponse): void {
  writeJsonResponse(response, payload.status, payload.body);
}

function assertKnownNodeAgentRequest(context: IntegrationNodeAgentRequestContext): void {
  switch (context.url.pathname) {
    case nodeDeployPathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeDeployRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeDrainDeploymentPathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeDrainDeploymentRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeInspectDeploymentPathname:
      assertNodeAgentMethod(context, 'GET');
      assertNoNodeAgentBody(context);
      nodeInspectDeploymentQuerySchema.parse(readSingleNodeAgentQueryParams(context.url));
      return;
    case nodeStopDeploymentPathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeStopDeploymentRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeProjectCleanupPathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeProjectCleanupRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeTailLogsPathname:
      assertNodeAgentMethod(context, 'GET');
      assertNoNodeAgentBody(context);
      nodeTailLogsQuerySchema.parse(readSingleNodeAgentQueryParams(context.url));
      return;
    case nodeResourceReconcilePathname:
    case nodeResourceStartPathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeResourceRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeResourceStopPathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeResourceStopRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeResourceDeletePathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeResourceDeleteRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeResourceRestartPolicyPathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeResourceRestartPolicyRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    case nodeResourceLogsPathname:
      assertNodeAgentMethod(context, 'GET');
      assertNoNodeAgentBody(context);
      nodeResourceLogsQuerySchema.parse(readSingleNodeAgentQueryParams(context.url));
      return;
    case nodeResourceOperationBackupPathname:
    case nodeResourceOperationRestorePathname:
      assertNodeAgentMethod(context, 'POST');
      assertNoNodeAgentQuery(context);
      nodeResourceOperationRequestSchema.parse(readJsonBodyValue(context.body));
      return;
    default:
      throw new Error(`Unexpected node runtime request: ${context.url.pathname}`);
  }
}

function parseNodeAgentRequestUrl(requestUrl: string): URL {
  if (!requestUrl.startsWith('/')) {
    throw new Error(`Unexpected absolute node runtime request target: ${requestUrl}`);
  }

  return new URL(requestUrl, nodeAgentRequestBaseUrl);
}

function assertNodeAgentAuthorization(context: IntegrationNodeAgentRequestContext): void {
  if (context.authorization === integrationNodeAgentAuthorization) {
    return;
  }

  throw new Error(`Unexpected node runtime authorization header for ${context.url.pathname}.`);
}

function assertNodeAgentMethod(context: IntegrationNodeAgentRequestContext, expectedMethod: string): void {
  if (context.method === expectedMethod) {
    return;
  }

  throw new Error(`Unexpected node runtime method for ${context.url.pathname}: ${context.method}.`);
}

function assertNoNodeAgentQuery(context: IntegrationNodeAgentRequestContext): void {
  if (context.url.search === '') {
    return;
  }

  throw new Error(`Unexpected node runtime query for ${context.url.pathname}.`);
}

function assertNoNodeAgentBody(context: IntegrationNodeAgentRequestContext): void {
  if (context.body === '') {
    return;
  }

  throw new Error(`Unexpected node runtime body for ${context.url.pathname}.`);
}

function writeDefaultNodeAgentResponse(context: IntegrationNodeAgentRequestContext, response: ServerResponse): void {
  switch (context.url.pathname) {
    case nodeDeployPathname:
      writeJsonResponse(response, 200, createDefaultNodeDeployResponse(readJsonBody<NodeDeployRequest>(context.body)));
      return;
    case nodeDrainDeploymentPathname:
      writeJsonResponse(response, 200, { acceptedAt: '2026-03-24T10:00:00.000Z' });
      return;
    case nodeInspectDeploymentPathname:
      writeJsonResponse(response, 200, { deployment: createDefaultNodeInspectedDeployment(context.url) });
      return;
    case nodeStopDeploymentPathname:
      writeJsonResponse(response, 200, { stoppedAt: '2026-03-24T10:00:00.000Z' });
      return;
    case nodeProjectCleanupPathname:
      readJsonBody<NodeProjectCleanupRequest>(context.body);
      writeJsonResponse(response, 200, createDefaultNodeProjectCleanupResponse());
      return;
    case nodeTailLogsPathname:
      writeJsonResponse(response, 200, { lines: [createDefaultNodeLogLine(context.url)] });
      return;
    case nodeResourceReconcilePathname:
    case nodeResourceStartPathname:
      writeJsonResponse(
        response,
        200,
        createDefaultNodeResourceResponse(readJsonBody<NodeResourceRequest>(context.body)),
      );
      return;
    case nodeResourceStopPathname:
      writeJsonResponse(
        response,
        200,
        createDefaultStoppedNodeResourceResponse(readJsonBody<NodeResourceStopRequest>(context.body)),
      );
      return;
    case nodeResourceDeletePathname:
      writeJsonResponse(
        response,
        200,
        createDefaultDeletedNodeResourceResponse(readJsonBody<NodeResourceDeleteRequest>(context.body)),
      );
      return;
    case nodeResourceRestartPolicyPathname:
      writeJsonResponse(
        response,
        200,
        createDefaultRestartPolicyNodeResourceResponse(readJsonBody<NodeResourceRestartPolicyRequest>(context.body)),
      );
      return;
    case nodeResourceLogsPathname:
      writeJsonResponse(response, 200, { lines: [createDefaultNodeResourceLogLine(context.url)] });
      return;
    case nodeResourceOperationBackupPathname:
    case nodeResourceOperationRestorePathname:
      writeJsonResponse(response, 200, { stderr: '', stdout: '{}' });
      return;
    default:
      writeJsonResponse(response, 404, {
        error: { message: `Unexpected node runtime request: ${context.url.pathname}` },
      });
  }
}

function createDefaultNodeDeployResponse(body: NodeDeployRequest): JsonValue {
  return {
    containerId: `container_${body.deploymentId}`,
    imageRef: body.imageRef,
    routeHost: body.routeHost,
    startedAt: '2026-03-24T10:00:00.000Z',
    upstreamHost: '127.0.0.1',
    upstreamPort: 31000,
  };
}

function createDefaultNodeProjectCleanupResponse(): JsonValue {
  return {
    cleanedAt: '2026-05-22T12:00:00.000Z',
  };
}

function createDefaultNodeInspectedDeployment(url: URL): JsonValue {
  const query: NodeInspectDeploymentQuery = nodeInspectDeploymentQuerySchema.parse(readSingleNodeAgentQueryParams(url));

  return {
    containerId: query.serviceName === 'web' ? 'container_123' : `container_${query.serviceName}`,
    imageRef: 'sha256:image',
    routeHost:
      query.serviceName === 'web'
        ? `${query.projectName}.localhost`
        : `${query.serviceName}-${query.projectName}.localhost`,
    upstreamHost: '127.0.0.1',
    upstreamPort: 31000,
  };
}

function createDefaultNodeLogLine(url: URL): JsonValue {
  const query: NodeTailLogsQuery = nodeTailLogsQuerySchema.parse(readSingleNodeAgentQueryParams(url));

  return {
    deploymentId: query.deploymentId,
    environmentName: query.environmentName,
    message: 'boot complete',
    serviceName: query.serviceName,
    stream: 'stdout',
    timestamp: '2026-03-24T10:00:00.000Z',
  };
}

function createDefaultNodeResourceResponse(body: NodeResourceRequest): JsonValue {
  return {
    containerId: `resource_${body.resourceName}`,
    hostname: body.hostname,
    status: 'running',
  };
}

function createDefaultStoppedNodeResourceResponse(body: NodeResourceStopRequest): JsonValue {
  return {
    containerId: body.containerId,
    hostname: buildCompartmentResourceHostname(body.projectName, body.environmentName, body.resourceName),
    status: 'stopped',
  };
}

function createDefaultDeletedNodeResourceResponse(body: NodeResourceDeleteRequest): JsonValue {
  return {
    containerId: null,
    hostname: buildCompartmentResourceHostname(body.projectName, body.environmentName, body.resourceName),
    status: 'stopped',
  };
}

function createDefaultRestartPolicyNodeResourceResponse(body: NodeResourceRestartPolicyRequest): JsonValue {
  return {
    containerId: body.containerId,
    hostname: buildCompartmentResourceHostname(body.projectName, body.environmentName, body.resourceName),
    status: 'running',
  };
}

function createDefaultNodeResourceLogLine(url: URL): JsonValue {
  const query: NodeResourceLogsQuery = nodeResourceLogsQuerySchema.parse(readSingleNodeAgentQueryParams(url));

  return {
    message: `${query.resourceName} ready`,
    resourceName: query.resourceName,
    stream: 'stdout',
    timestamp: '2026-03-24T10:00:00.000Z',
  };
}

function readSingleNodeAgentQueryParams(url: URL): Record<string, string> {
  const queryParams: Record<string, string> = {};
  for (const [name, value] of url.searchParams) {
    if (Object.hasOwn(queryParams, name)) {
      throw new Error(`Duplicate node runtime query parameter: ${name}`);
    }

    queryParams[name] = value;
  }

  return queryParams;
}

function readJsonBodyValue(body: string): JsonValue {
  return JSON.parse(body) as JsonValue;
}

function readJsonBody<TValue>(body: string): TValue {
  return JSON.parse(body) as TValue;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer<ArrayBufferLike>[] = [];
  const requestBodyStream: AsyncIterable<string | Buffer<ArrayBufferLike>> = request;

  for await (const chunk of requestBodyStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function listenOnSocket(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
    server.once('error', reject);
    server.listen(socketPath, (): void => {
      server.off('error', reject);
      resolve();
    });
  });
}

function writeJsonResponse(response: ServerResponse, statusCode: number, payload: JsonValue): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}
