const repositoryComponent: string = String.raw`[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*`;
const registryComponent: string = String.raw`[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]+)?`;
const repository: string = String.raw`(?:${registryComponent}/)?${repositoryComponent}(?:/${repositoryComponent})*`;
const digest: string = String.raw`sha256:[a-f0-9]{64}`;
const tag: string = String.raw`[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}`;
const digestPinnedImagePattern: RegExp = new RegExp(String.raw`^${repository}@${digest}$`, 'u');
const tagAndDigestPinnedImagePattern: RegExp = new RegExp(String.raw`^${repository}:${tag}@${digest}$`, 'u');

export function isDigestPinnedContainerImageReference(value: string): boolean {
  return digestPinnedImagePattern.test(value);
}

export function isTagAndDigestPinnedContainerImageReference(value: string): boolean {
  return tagAndDigestPinnedImagePattern.test(value);
}
