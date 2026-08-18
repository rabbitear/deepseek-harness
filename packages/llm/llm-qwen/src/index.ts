/**
 * Register a {@link QwenAdapter} for the `qwen-local` provider route on
 * `ctx.llm`, with connection facts resolved per request instead of frozen at
 * load. The plugin layers its `cordis.yml` entry config under the optional
 * `llm-qwen` user-settings section (`ctx.settings`) so a changed model id,
 * base URL, or output cap reaches the very next request without restarting
 * anything, while an in-flight stream keeps the facts it started with.
 *
 * The provider talks to a local OpenAI-compatible chat-completions endpoint —
 * typically the host's torch-native server on the loopback network. No API key
 * is required; an empty token leaves the request unauthenticated.
 * @module @deepseek-ai/dsh-llm-qwen
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { settingsNamespace, installSettingsSection, deepEqualJson } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { QwenAdapter, resolveAdapterOptions } from './adapter.ts'

export { QwenAdapter } from './adapter.ts'
export { parseSse, parseFallbackBody, LlmStreamClosedError } from './sse.ts'
export type { QwenAdapterOptions, QwenConnectionOptions } from './adapter.ts'

export const name = 'llm-qwen'
export const inject = ['llm']

const NS = settingsNamespace('llm-qwen')
const PROVIDER = 'qwen-local'
const DEFAULT_MODEL = 'Qwen/Qwen3-8B'

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Local endpoint base; `/v1/chat/completions` is appended. */
  baseURL: string
  /** Model id advertised by the endpoint and forwarded on requests. */
  modelId?: string
  /** Positive context capacity used when the model has no exact value. */
  defaultContextWindow?: number
  /** Default per-request output cap; explicit request values win. */
  maxTokens?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

export const Config: z<Config> = z.object({
  baseURL: z.string().required(),
  modelId: z.string().default(DEFAULT_MODEL),
  defaultContextWindow: z.number().step(1).min(1).default(131_072),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(4096),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(300_000),
  retryPolicy: RetryPolicySchema,
})

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ReturnType<typeof resolveAdapterOptions> | undefined

  const options = (): ReturnType<typeof resolveAdapterOptions> => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-qwen: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const adapter = new QwenAdapter({
    options,
    resolveToken: async () => undefined,
    readError: (_status, body) => {
      // Surface a provider error body when present.
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } }
        if (parsed.error?.message) return `llm-qwen: ${parsed.error.message}`
      } catch {
        // not JSON — fall through to generic message
      }
      return undefined
    },
  })

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Qwen Local', settingsNs: NS, settingsPath: [] },
  ])

  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })
}
