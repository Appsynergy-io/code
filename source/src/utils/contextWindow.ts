/** 200k-window reference used to scale buffers. Not a hard max. */
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

/** Compact streaming fallback output cap (200k-window reference). */
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

const CONTEXT_BUFFER_FLOOR = 512

/** Scale a 200k-window reference buffer to the detected window. */
export function scaleTokensForContextWindow(
  referenceTokens: number,
  window: number,
): number {
  return Math.max(
    CONTEXT_BUFFER_FLOOR,
    Math.round((referenceTokens / MODEL_CONTEXT_WINDOW_DEFAULT) * window),
  )
}

/** Compact streaming fallback output cap — same reserve as autocompact. */
export function getCompactMaxOutputTokensForWindow(
  window: number,
  modelMaxOutput: number,
): number {
  const reservedCap = Math.min(
    COMPACT_MAX_OUTPUT_TOKENS,
    scaleTokensForContextWindow(COMPACT_MAX_OUTPUT_TOKENS, window),
  )
  return Math.min(reservedCap, modelMaxOutput)
}
