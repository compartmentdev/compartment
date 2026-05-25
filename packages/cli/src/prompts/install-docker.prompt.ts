import type { CliIo } from '../app.types';
import { readPromptLine } from './prompt-reader';

const installDockerPromptLabel: string =
  'Docker is not installed. Install Docker Engine and the Docker Compose plugin now? [Y/n]: ';

export async function promptInstallDocker(io: CliIo): Promise<boolean> {
  for (;;) {
    const answer: string = (await readPromptLine(io, installDockerPromptLabel)).trim().toLowerCase();
    if (answer === '' || answer === 'y' || answer === 'yes') {
      return true;
    }

    if (answer === 'n' || answer === 'no') {
      return false;
    }

    io.stderr('Enter `y` or `n`.\n');
  }
}
