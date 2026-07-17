#!/usr/bin/env node

const imageRef = process.argv.at(-1);
const digest = imageRef?.split('@').at(1);

if (process.argv[2] !== 'verify' || digest === undefined || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
  process.stderr.write('The k3d cosign fixture verifies only pre-resolved sha256 image references.\n');
  process.exit(1);
}

process.stdout.write(`${JSON.stringify([{ critical: { image: { 'docker-manifest-digest': digest } } }])}\n`);
