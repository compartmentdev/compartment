#!/usr/bin/env node

import { basename } from 'node:path';
import { applyBinExecutionCwd } from './bin-cwd';
import { runCli } from './app';

applyBinExecutionCwd();

void runBin();

async function runBin(): Promise<void> {
  if (isNodeAgentInvocation()) {
    const { runNodeAgent } = await import('@compartment/node/agent');
    await runNodeAgent();
    return;
  }

  const exitCode: number = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}

function isNodeAgentInvocation(): boolean {
  return (
    basename(process.execPath) === 'compartment-node-agent' ||
    basename(process.argv[1] ?? '') === 'compartment-node-agent'
  );
}
