import { setImmediate } from 'node:timers';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runMain } from './run-main.mjs';

// A checkout path is not always plain ASCII: release worktrees carry spaces, and `#` or non-ASCII
// characters appear in developer home directories. Comparing an argv path against a URL pathname
// silently disagrees on all of them, which would make an entrypoint exit without running.
const awkwardEntryPath = '/tmp/release candidate #2/gate.mjs';
const awkwardEntryUrl = pathToFileURL(awkwardEntryPath).href;

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('runMain', () => {
  it('runs main when the entry path needs URL encoding', async () => {
    const main = vi.fn();

    expect(new URL(awkwardEntryUrl).pathname).not.toBe(awkwardEntryPath);

    runMain(awkwardEntryUrl, awkwardEntryPath, main);

    await vi.waitFor(() => expect(main).toHaveBeenCalledOnce());
  });

  it('ignores another entry path and a missing entry path', async () => {
    const main = vi.fn();

    runMain(awkwardEntryUrl, '/tmp/release candidate #2/other-gate.mjs', main);
    runMain(awkwardEntryUrl, undefined, main);

    await new Promise((resolveTick) => {
      setImmediate(resolveTick);
    });
    expect(main).not.toHaveBeenCalled();
  });

  it.each([
    [
      'synchronous',
      () => {
        throw new Error('gate failed');
      },
    ],
    [
      'asynchronous',
      async () => {
        throw new Error('gate failed');
      },
    ],
  ])('reports a %s main that throws', async (_kind, main) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    runMain(awkwardEntryUrl, awkwardEntryPath, main);

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(stderr.mock.calls[0][0]).toContain('gate failed');
  });

  it('leaves the exit code alone when main resolves', async () => {
    const main = vi.fn();

    runMain(awkwardEntryUrl, awkwardEntryPath, main);

    await vi.waitFor(() => expect(main).toHaveBeenCalledOnce());
    expect(process.exitCode).toBeUndefined();
  });
});
