export function getBinaryName(platform: string): string {
  return platform.startsWith('win32') ? 'claude.exe' : 'claude'
}

/** `{base}/{version}/{platform}/{claude[.exe]}` — binary-repo artifact URL. */
export function binaryArtifactUrl(
  baseUrl: string,
  version: string,
  platform: string,
): string {
  return `${baseUrl}/${version}/${platform}/${getBinaryName(platform)}`
}
