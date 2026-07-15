#!/usr/bin/env node

import { applyBinExecutionCwd } from './bin-cwd';
import { runCli } from './app';

applyBinExecutionCwd();

void runBin();

async function runBin(): Promise<void> {
  const exitCode: number = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
