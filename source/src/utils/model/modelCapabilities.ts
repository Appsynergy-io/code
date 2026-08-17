import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import isEqual from 'lodash-es/isEqual.js'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { z } from 'zod/v4'
import { OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getAnthropicClient } from '../../services/api/client.js'
import { isClaudeAISubscriber } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { safeParseJSON } from '../json.js'
import { lazySchema } from '../lazySchema.js'
import { isEssentialTrafficOnly } from '../privacyLevel.js'
import { jsonStringify } from '../slowOperations.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'

// .strip() — don't persist internal-only fields (mycro_deployments etc.) to disk.
// context_length / max_model_len are common local-provider aliases.
const ModelCapabilitySchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      max_input_tokens: z.number().optional(),
      max_tokens: z.number().optional(),
      context_length: z.number().optional(),
      max_model_len: z.number().optional(),
    })
    .strip(),
)

const CacheFileSchema = lazySchema(() =>
  z.object({
    models: z.array(ModelCapabilitySchema()),
    timestamp: z.number(),
  }),
)

export type ModelCapability = {
  id: string
  max_input_tokens?: number
  max_tokens?: number
}

function normalizeCapability(raw: {
  id: string
  max_input_tokens?: number
  max_tokens?: number
  context_length?: number
  max_model_len?: number
}): ModelCapability {
  const max_input_tokens =
    raw.max_input_tokens ?? raw.context_length ?? raw.max_model_len
  return {
    id: raw.id,
    ...(max_input_tokens !== undefined ? { max_input_tokens } : {}),
    ...(raw.max_tokens !== undefined ? { max_tokens: raw.max_tokens } : {}),
  }
}

function getCacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'cache')
}

function getCachePath(): string {
  return join(getCacheDir(), 'model-capabilities.json')
}

/** Refresh hits any first-party-shaped endpoint, including local proxies. */
function isModelCapabilitiesRefreshEligible(): boolean {
  return getAPIProvider() === 'firstParty'
}

// Longest-id-first so substring match prefers most specific; secondary key for stable isEqual
function sortForMatching(models: ModelCapability[]): ModelCapability[] {
  return [...models].sort(
    (a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id),
  )
}

// Keyed on cache path so tests that set CLAUDE_CONFIG_DIR get a fresh read
const loadCache = memoize(
  (path: string): ModelCapability[] | null => {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- memoized; called from sync getContextWindowForModel
      const raw = readFileSync(path, 'utf-8')
      const parsed = CacheFileSchema().safeParse(safeParseJSON(raw, false))
      return parsed.success
        ? parsed.data.models.map(normalizeCapability)
        : null
    } catch {
      return null
    }
  },
  path => path,
)

// Last successful provider list — wins over a stale disk cache for this process.
let runtimeCapabilities: ModelCapability[] | null = null

function findCapability(
  models: ModelCapability[],
  model: string,
): ModelCapability | undefined {
  const m = model.toLowerCase()
  const exact = models.find(c => c.id.toLowerCase() === m)
  if (exact) return exact
  return models.find(c => m.includes(c.id.toLowerCase()))
}

export function getModelCapability(model: string): ModelCapability | undefined {
  if (runtimeCapabilities && runtimeCapabilities.length > 0) {
    const fromRuntime = findCapability(runtimeCapabilities, model)
    if (fromRuntime) return fromRuntime
  }
  const cached = loadCache(getCachePath())
  if (!cached || cached.length === 0) return undefined
  return findCapability(cached, model)
}

/**
 * Advertised input window from provider/runtime config (models.list cache or
 * last refresh). No floor or ceiling — callers default to 200k when absent.
 */
export function getAdvertisedMaxInputTokens(model: string): number | undefined {
  const cap = getModelCapability(model)
  if (cap?.max_input_tokens && cap.max_input_tokens > 0) {
    return cap.max_input_tokens
  }
  return undefined
}

export async function refreshModelCapabilities(): Promise<void> {
  if (!isModelCapabilitiesRefreshEligible()) return
  if (isEssentialTrafficOnly()) return

  try {
    const anthropic = await getAnthropicClient({ maxRetries: 1 })
    const betas =
      isClaudeAISubscriber() && isFirstPartyAnthropicBaseUrl()
        ? [OAUTH_BETA_HEADER]
        : undefined
    const parsed: ModelCapability[] = []
    for await (const entry of anthropic.models.list({ betas })) {
      const result = ModelCapabilitySchema().safeParse(entry)
      if (result.success) parsed.push(normalizeCapability(result.data))
    }
    if (parsed.length === 0) return

    const models = sortForMatching(parsed)
    runtimeCapabilities = models

    const path = getCachePath()
    if (isEqual(loadCache(path), models)) {
      logForDebugging('[modelCapabilities] cache unchanged, skipping write')
      return
    }

    await mkdir(getCacheDir(), { recursive: true })
    await writeFile(path, jsonStringify({ models, timestamp: Date.now() }), {
      encoding: 'utf-8',
      mode: 0o600,
    })
    loadCache.cache.delete(path)
    logForDebugging(`[modelCapabilities] cached ${models.length} models`)
  } catch (error) {
    logForDebugging(
      `[modelCapabilities] fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}
