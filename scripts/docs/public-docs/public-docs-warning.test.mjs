import { describe, expect, it } from 'vitest';

import { writePublicDocsWarning } from '../../../.codex/skills/open-pr-and-monitor/scripts/public_docs_warning.mjs';

describe('writePublicDocsWarning', () => {
  it('writes a warning when an impacted area has no curated guide change', async () => {
    const output = await runWarningCheck('M\0packages/contracts/src/contracts/users.contract.ts\0');
    expect(output).toContain('Organizations, Users, Roles, Groups, and Assignments');
    expect(output).toContain('access-organizations-users-and-roles.md');
  });

  it('writes a warning for the access SDK surface', async () => {
    const output = await runWarningCheck('M\0packages/sdk/src/services/access-role.service.ts\0');
    expect(output).toContain('Organizations, Users, Roles, Groups, and Assignments');
    expect(output).toContain('roles-and-permissions.md');
  });

  it('does not warn when a curated guide rename is already in the diff', async () => {
    const output = await runWarningCheck(
      'R100\0public-docs/src/content/docs/manage-access/access-organizations-users-and-roles.md\0public-docs/src/content/docs/manage-access/access-org-users-roles.md\0M\0packages/contracts/src/contracts/users.contract.ts\0',
    );

    expect(output).toBe('');
  });

  it('does not warn when a new access guide already changed for a scope-resolution source', async () => {
    const output = await runWarningCheck(
      'M\0public-docs/src/content/docs/manage-access/troubleshoot-access.md\0M\0packages/contracts/src/contracts/compartment-access.contract.ts\0',
    );

    expect(output).toBe('');
  });
});

async function runWarningCheck(diffOutput) {
  let output = '';

  await writePublicDocsWarning({
    headSha: 'HEAD',
    maxBufferBytes: 1024 * 1024,
    stderr: {
      write(chunk) {
        output += chunk;
      },
    },
    execFile: async (file, args) => {
      await Promise.resolve();

      if (file !== 'git') {
        throw new Error(`Unexpected file: ${file}`);
      }

      if (args[0] === 'merge-base') {
        return { stdout: 'base-sha\n' };
      }

      if (args[0] === 'diff') {
        return { stdout: diffOutput };
      }

      throw new Error(`Unexpected args: ${args.join(' ')}`);
    },
  });

  return output;
}
