export function getBinaryName(platform: string): string {
  return platform.startsWith('win32') ? 'claude.exe' : 'claude'
}

/** Flattened asset name. GitHub forbids `/` in release asset names and 500s on tags with two slashes. */
export function binaryAssetName(platform: string): string {
  return `${platform}-${getBinaryName(platform)}`
}

/** `{base}/{version}/{platform}-{claude[.exe]}` — GitHub tag `release-index/{version}`, asset `linux-x64-claude`. */
export function binaryArtifactUrl(
  baseUrl: string,
  version: string,
  platform: string,
): string {
  return `${baseUrl}/${version}/${binaryAssetName(platform)}`
}
