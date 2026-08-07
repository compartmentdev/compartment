import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const scriptPath = resolve(
  import.meta.dirname,
  '../../.codex/skills/open-pr-and-monitor/scripts/wait_for_pr_feedback.mjs',
);

describe('open PR monitor script', () => {
  it('exposes a one-shot interface without polling options', () => {
    const help = spawnSync(process.execPath, [scriptPath, '--help'], {
      encoding: 'utf8',
      timeout: 1_000,
    });

    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Reads the current PR checks, feedback, and merge state once');
    expect(help.stdout).not.toContain('interval');
    expect(help.stdout).not.toContain('timeout');

    const removedOption = spawnSync(process.execPath, [scriptPath, '--interval-seconds', '5'], {
      encoding: 'utf8',
      timeout: 1_000,
    });

    expect(removedOption.status).toBe(1);
    expect(removedOption.stderr).toContain('Unknown argument: --interval-seconds');
  });
});
