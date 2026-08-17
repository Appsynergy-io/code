export function getBinaryName(platform: string): string {
  return platform.startsWith('win32') ? 'claude.exe' : 'claude'
}

/** All index assets live on tag `release-index`. Nested tags like `release-index/2.1.88` make git refuse the parent tag `release-index`. */
export function binaryAssetName(version: string, platform: string): string {
  return `${version}-${platform}-${getBinaryName(platform)}`
}

export function manifestAssetName(version: string): string {
  return `${version}-manifest.json`
}

export function manifestUrl(baseUrl: string, version: string): string {
  return `${baseUrl}/${manifestAssetName(version)}`
}

export function binaryArtifactUrl(
  baseUrl: string,
  version: string,
  platform: string,
): string {
  return `${baseUrl}/${binaryAssetName(version, platform)}`
}
