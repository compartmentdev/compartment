import { createNodeApp } from './app';
import type { NodeApp } from './app.types';
import { readNodeConfig, type NodeConfig } from './config';
import { prepareNodeAgentSocketPath, restrictNodeAgentSocketPathPermissions } from './node-agent-socket-path';

export async function runNodeAgent(): Promise<void> {
  const config: NodeConfig = readNodeConfig();
  const app: NodeApp = createNodeApp({
    config,
  });
  prepareNodeAgentSocketPath(config.nodeSocketPath, config.runtimeSocketGid);
  await app.listen({
    path: config.nodeSocketPath,
  });
  restrictNodeAgentSocketPathPermissions(config.nodeSocketPath, config.runtimeSocketGid);
}
