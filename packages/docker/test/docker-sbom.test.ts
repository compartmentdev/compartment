import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { scanDockerImageSbom } from '../src/docker-sbom';

interface ExecaResult {
  stdout: string;
}

interface ExecaOptions {
  env: Record<string, string>;
  extendEnv: boolean;
}

type RunExeca = (file: string, args: string[], options: ExecaOptions) => Promise<ExecaResult>;

const runExeca: Mock<RunExeca> = vi.hoisted((): Mock<RunExeca> => vi.fn<RunExeca>());

vi.mock('execa', (): { execa: Mock<RunExeca> } => ({ execa: runExeca }));

describe('scanDockerImageSbom', (): void => {
  afterEach((): void => {
    delete process.env.COMPARTMENT_BUILD_JOB_INPUT;
    runExeca.mockReset();
  });

  it('scans the immutable registry image and returns a digest of the real Syft document', async (): Promise<void> => {
    process.env.COMPARTMENT_BUILD_JOB_INPUT = 'plaintext-build-secret';
    const json: string = JSON.stringify({ artifacts: [{ name: 'ffmpeg', version: '7' }], source: { type: 'image' } });
    runExeca.mockResolvedValueOnce({ stdout: json });

    await expect(
      scanDockerImageSbom(
        `registry.internal/project/service@sha256:${'a'.repeat(64)}`,
        { password: 'secret', serverAddress: 'registry.internal', username: 'artifact-writer' },
        true,
      ),
    ).resolves.toEqual({
      digest: `sha256:${createHash('sha256').update(`${json}\n`).digest('hex')}`,
      json: `${json}\n`,
    });

    const [file, args, options] = runExeca.mock.calls[0]!;
    expect(file).toBe('syft');
    expect(args).toEqual([
      'scan',
      `registry:registry.internal/project/service@sha256:${'a'.repeat(64)}`,
      '--output',
      'syft-json',
    ]);
    expect(options.env.DOCKER_CONFIG).toEqual(expect.any(String));
    expect(options.env.SYFT_REGISTRY_INSECURE_USE_HTTP).toBe('true');
    expect(options.extendEnv).toBe(false);
    expect(options.env.COMPARTMENT_BUILD_JOB_INPUT).toBeUndefined();
    expect(JSON.stringify(runExeca.mock.calls)).not.toContain('secret');
    delete process.env.COMPARTMENT_BUILD_JOB_INPUT;
  });
});
