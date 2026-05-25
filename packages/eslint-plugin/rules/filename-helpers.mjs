export function normalizeFilename(filename) {
  return filename.replaceAll('\\', '/');
}

export function isVirtualFilename(filename) {
  return filename === '<input>' || filename === '<text>';
}
