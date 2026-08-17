// Empty until the branding scanner lands.
export type BrandingAudit = {
  changed: string[]
  preserved: string[]
  generated: string[]
  needsReview: string[]
}

export function runBrandingAudit(): BrandingAudit {
  return {
    changed: [],
    preserved: [],
    generated: [],
    needsReview: [],
  }
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(runBrandingAudit(), null, 2)}\n`)
}
