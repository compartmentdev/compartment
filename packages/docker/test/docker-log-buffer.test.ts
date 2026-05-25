import { describe, expect, it } from 'vitest';
import { parseDockerMultiplexedLogBuffer } from '../src/docker-log-buffer';

describe('parseDockerMultiplexedLogBuffer', (): void => {
  it('preserves strict frame order across stdout and stderr', (): void => {
    const buffer: Buffer = Buffer.concat([
      createDockerLogFrame('stdout', '2026-04-07T16:00:00.000000000Z boot complete\n'),
      createDockerLogFrame('stderr', '2026-04-07T16:00:01.000000000Z traceback line\n'),
      createDockerLogFrame('stdout', 'bare-line\n'),
    ]);

    expect(parseDockerMultiplexedLogBuffer(buffer)).toEqual([
      {
        message: 'boot complete',
        stream: 'stdout',
        timestamp: '2026-04-07T16:00:00.000000000Z',
      },
      {
        message: 'traceback line',
        stream: 'stderr',
        timestamp: '2026-04-07T16:00:01.000000000Z',
      },
      {
        message: 'bare-line',
        stream: 'stdout',
        timestamp: null,
      },
    ]);
  });

  it('returns no log lines for an empty buffer', (): void => {
    expect(parseDockerMultiplexedLogBuffer(Buffer.alloc(0))).toEqual([]);
  });

  it('fails fast for non-multiplexed docker logs output', (): void => {
    const buffer: Buffer = Buffer.from('2026-04-07T16:00:00.000000000Z boot complete\nbare-line', 'utf8');

    expect((): void => {
      parseDockerMultiplexedLogBuffer(buffer);
    }).toThrow('Expected Docker logs output to use the multiplexed frame format.');
  });
});

function createDockerLogFrame(stream: 'stdout' | 'stderr', text: string): Buffer {
  const payload: Buffer = Buffer.from(text, 'utf8');
  const header: Buffer = Buffer.alloc(8);

  header[0] = stream === 'stdout' ? 1 : 2;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}
