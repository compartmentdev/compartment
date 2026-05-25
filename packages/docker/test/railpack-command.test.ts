import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ExecFileOptions } from 'node:child_process';
import { prepareRailpackPlan } from '../src/railpack-command';

type ExecuteFileAsync = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }>;
type RunMkdir = (path: string, options?: { recursive?: boolean }) => Promise<void>;

interface RailpackCommandTestMocks {
  executeFileAsync: Mock<ExecuteFileAsync>;
  mkdir: Mock<RunMkdir>;
}

const mocks: RailpackCommandTestMocks = vi.hoisted(
  (): RailpackCommandTestMocks => ({
    executeFileAsync: vi.fn<ExecuteFileAsync>(),
    mkdir: vi.fn<RunMkdir>(),
  }),
);

vi.mock('node:child_process', (): { execFile: Mock<() => void> } => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', (): { mkdir: Mock<RunMkdir> } => ({
  mkdir: mocks.mkdir,
}));

vi.mock('node:util', (): { promisify: Mock<() => Mock<ExecuteFileAsync>> } => ({
  promisify: vi.fn((): Mock<ExecuteFileAsync> => mocks.executeFileAsync),
}));

afterEach((): void => {
  mocks.executeFileAsync.mockReset();
  mocks.mkdir.mockReset();
  delete process.env.RAILPACK_BUILD_APT_PACKAGES;
  delete process.env.RAILPACK_DEPLOY_APT_PACKAGES;
  delete process.env.RAILPACK_SPA_OUTPUT_DIR;
  delete process.env.RAILPACK_STATIC_FILE_ROOT;
});

describe('prepareRailpackPlan', (): void => {
  it('runs the local Railpack CLI against the build context while targeting the service path', async (): Promise<void> => {
    mocks.mkdir.mockResolvedValueOnce();
    mocks.executeFileAsync.mockResolvedValueOnce({
      stderr: '',
      stdout: '',
    });

    await expect(
      prepareRailpackPlan({
        appPath: 'apps/web',
        buildCommand: 'pnpm build',
        contextDirectory: '/tmp/source',
        infoPath: '/tmp/railpack/railpack-info.json',
        planPath: '/tmp/railpack/railpack-plan.json',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.mkdir).toHaveBeenCalledWith('/tmp/railpack', { recursive: true });
    expect(mocks.executeFileAsync).toHaveBeenCalledWith(
      'railpack',
      [
        'prepare',
        'apps/web',
        '--build-cmd',
        'pnpm build',
        '--plan-out',
        '/tmp/railpack/railpack-plan.json',
        '--info-out',
        '/tmp/railpack/railpack-info.json',
      ],
      expect.objectContaining({
        cwd: '/tmp/source',
      }),
    );
  });

  it('passes resolved build and runtime apt packages through Railpack env args', async (): Promise<void> => {
    mocks.mkdir.mockResolvedValueOnce();
    mocks.executeFileAsync.mockResolvedValueOnce({
      stderr: '',
      stdout: '',
    });

    await expect(
      prepareRailpackPlan({
        appPath: 'apps/web',
        buildAptPackages: ['build-essential'],
        contextDirectory: '/tmp/source',
        infoPath: '/tmp/railpack/railpack-info.json',
        planPath: '/tmp/railpack/railpack-plan.json',
        runtimeAptPackages: ['libnss3', 'libxss1'],
      }),
    ).resolves.toBeUndefined();

    expect(mocks.executeFileAsync).toHaveBeenCalledWith(
      'railpack',
      [
        'prepare',
        'apps/web',
        '--env',
        'RAILPACK_BUILD_APT_PACKAGES=build-essential',
        '--env',
        'RAILPACK_DEPLOY_APT_PACKAGES=libnss3 libxss1',
        '--plan-out',
        '/tmp/railpack/railpack-plan.json',
        '--info-out',
        '/tmp/railpack/railpack-info.json',
      ],
      expect.objectContaining({
        cwd: '/tmp/source',
      }),
    );

    const executeOptions: ExecFileOptions | undefined = mocks.executeFileAsync.mock.calls[0]?.[2];
    expect(executeOptions?.env?.RAILPACK_BUILD_APT_PACKAGES).toBeUndefined();
    expect(executeOptions?.env?.RAILPACK_DEPLOY_APT_PACKAGES).toBeUndefined();
  });

  it('clears inherited Railpack apt package env vars when no packages are requested', async (): Promise<void> => {
    process.env.RAILPACK_BUILD_APT_PACKAGES = 'build-essential';
    process.env.RAILPACK_DEPLOY_APT_PACKAGES = 'libnss3 libxss1';
    mocks.mkdir.mockResolvedValueOnce();
    mocks.executeFileAsync.mockResolvedValueOnce({
      stderr: '',
      stdout: '',
    });

    await expect(
      prepareRailpackPlan({
        contextDirectory: '/tmp/source',
        infoPath: '/tmp/railpack/railpack-info.json',
        planPath: '/tmp/railpack/railpack-plan.json',
      }),
    ).resolves.toBeUndefined();

    const executeOptions: ExecFileOptions | undefined = mocks.executeFileAsync.mock.calls[0]?.[2];
    expect(executeOptions?.env?.RAILPACK_BUILD_APT_PACKAGES).toBeUndefined();
    expect(executeOptions?.env?.RAILPACK_DEPLOY_APT_PACKAGES).toBeUndefined();
  });

  it('rejects outputs that do not share the same directory', async (): Promise<void> => {
    await expect(
      prepareRailpackPlan({
        contextDirectory: '/tmp/source',
        infoPath: '/tmp/railpack/info/railpack-info.json',
        planPath: '/tmp/railpack/plan/railpack-plan.json',
      }),
    ).rejects.toThrow('Railpack plan and info outputs must share the same directory.');
  });

  it('fails fast with a clear message when Railpack is missing from PATH', async (): Promise<void> => {
    const error: Error & { code?: string | undefined } = new Error('spawn railpack ENOENT');
    error.code = 'ENOENT';
    mocks.mkdir.mockResolvedValueOnce();
    mocks.executeFileAsync.mockRejectedValueOnce(error);

    await expect(
      prepareRailpackPlan({
        contextDirectory: '/tmp/source',
        infoPath: '/tmp/railpack/railpack-info.json',
        planPath: '/tmp/railpack/railpack-plan.json',
      }),
    ).rejects.toThrow(
      'Railpack CLI is required on PATH. Install it with `curl -sSL https://railpack.com/install.sh | sh` before running source builds.',
    );
  });
});
