import type { DockerLogLine, DockerLogStream } from './docker-models';

interface DockerLogBufferParseOptions {
  timestamps?: boolean | undefined;
}

interface DockerFrameResult {
  lines: DockerLogLine[];
  nextOffset: number;
}

export function parseDockerMultiplexedLogBuffer(
  buffer: Buffer,
  options: DockerLogBufferParseOptions = {},
): DockerLogLine[] {
  if (buffer.length === 0) {
    return [];
  }

  ensureDockerMultiplexedLogBuffer(buffer);
  return parseDockerFrames(buffer, options.timestamps ?? true);
}

function ensureDockerMultiplexedLogBuffer(buffer: Buffer): void {
  ensureDockerFrameHeader(buffer, 0);

  if (buffer[1] !== 0 || buffer[2] !== 0 || buffer[3] !== 0) {
    throw new Error('Expected Docker logs output to use the multiplexed frame format.');
  }

  const firstStreamType: number | undefined = buffer[0];
  if (firstStreamType === undefined) {
    throw new Error('Docker logs buffer ended before the frame header.');
  }

  readDockerLogStream(firstStreamType);
}

function parseDockerFrames(buffer: Buffer, timestamps: boolean): DockerLogLine[] {
  const lines: DockerLogLine[] = [];
  let offset: number = 0;

  while (offset < buffer.length) {
    const frameResult: DockerFrameResult = readDockerFrame(buffer, offset, timestamps);
    lines.push(...frameResult.lines);
    offset = frameResult.nextOffset;
  }

  return lines;
}

function readDockerFrame(buffer: Buffer, offset: number, timestamps: boolean): DockerFrameResult {
  ensureDockerFrameHeader(buffer, offset);

  const payloadLength: number = buffer.readUInt32BE(offset + 4);
  const streamType: number | undefined = buffer[offset];
  if (streamType === undefined) {
    throw new Error('Docker logs buffer ended before the frame header.');
  }

  const payloadStart: number = offset + 8;
  const payloadEnd: number = payloadStart + payloadLength;
  if (payloadEnd > buffer.length) {
    throw new Error('Docker logs buffer ended mid-frame.');
  }

  return {
    lines: parseDockerTextLines(
      buffer.toString('utf8', payloadStart, payloadEnd),
      readDockerLogStream(streamType),
      timestamps,
    ),
    nextOffset: payloadEnd,
  };
}

function ensureDockerFrameHeader(buffer: Buffer, offset: number): void {
  if (offset + 8 > buffer.length) {
    throw new Error('Docker logs buffer ended before the frame header.');
  }
}

function readDockerLogStream(streamType: number): DockerLogStream {
  if (streamType === 1) {
    return 'stdout';
  }

  if (streamType === 2) {
    return 'stderr';
  }

  throw new Error(`Unsupported Docker logs stream type: ${streamType.toString()}`);
}

function parseDockerTextLines(text: string, stream: DockerLogStream, timestamps: boolean): DockerLogLine[] {
  const lines: string[] = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }

  return lines.map((line: string): DockerLogLine => parseDockerLogLine(stream, line.replace(/\r$/, ''), timestamps));
}

function parseDockerLogLine(stream: DockerLogStream, text: string, timestamps: boolean): DockerLogLine {
  if (!timestamps) {
    return {
      message: text,
      stream,
      timestamp: null,
    };
  }

  const firstSpaceIndex: number = text.indexOf(' ');
  if (firstSpaceIndex === -1) {
    return {
      message: text,
      stream,
      timestamp: null,
    };
  }

  return {
    message: text.slice(firstSpaceIndex + 1),
    stream,
    timestamp: text.slice(0, firstSpaceIndex),
  };
}
