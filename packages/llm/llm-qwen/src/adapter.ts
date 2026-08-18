/**
 * `QwenAdapter`: fetch + SSE against a local OpenAI-compatible chat-completions
 * endpoint serving a Qwen model (e.g. the host's torch-native server), emitting
 * harness StreamChunks. This adapter bridges the dsh agent loop to a directly
 * hosted model over the loopback network, so the model stays resident in its
 * own (ROCm) environment while the jailed harness reaches it over TCP.
 *
 * The provider is transport-only, mirroring `DeepSeekAdapter`: connection facts
 * arrive through a thunk resolved once per operation, so config changes reach
 * the next request without re-registration.
 *
 * @module @deepseek-ai/dsh-llm-qwen
 */

import { CallId, LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  RetryPolicyConfig,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { parseSse, parseFallbackBody, LlmStreamClosedError } from './sse.ts'

/** Connection facts for one operation, the adapter's only explicit resolve step. */
export interface QwenConnectionOptions {
  /** Endpoint base; `/v1/chat/completions` is appended. */
  baseURL: string
  /** Model id advertised by the endpoint's `/v1/models` (also forwarded to the request). */
  modelId: string
  /** Positive context capacity used when the model has no exact value. */
  defaultContextWindow: number
  /** Default per-request output cap; explicit request values win. */
  maxTokens: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /** Provider-owned retry policy, already resolved. */
  retryPolicy: ResolvedRetryPolicy
}

/** Constructor options: the operation-local resolution hooks the plugin owns. */
export interface QwenAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  options: () => QwenConnectionOptions
  /** Resolve the optional bearer token for one request (empty when the server is open). */
  resolveToken?: (connection: QwenConnectionOptions) => Promise<string | undefined>
  /** Read the response head for diagnostics (server errors) when a non-2xx arrives. */
  readError?: (status: number, body: string) => string | undefined
}

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Default combined request/response context capacity. */
export const DEFAULT_CONTEXT_WINDOW = 131_072
/** Default per-request output-token cap. */
export const DEFAULT_MAX_TOKENS = 4096
/** The model id the adapter advertises when none is configured. */
export const DEFAULT_MODEL_ID = 'Qwen/Qwen3-8B'

/**
 * The one explicit resolve step from validated plugin config to connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * defaults and bounds are re-judged here and fail loud.
 * @param config - raw plugin config or resolved settings snapshot.
 * @returns validated connection facts.
 */
export function resolveAdapterOptions(config: {
  baseURL: string
  modelId?: string
  defaultContextWindow?: number
  maxTokens?: number
  streamIdleTimeoutMs?: number
  retryPolicy?: RetryPolicyConfig
}): QwenConnectionOptions {
  if (config.baseURL.length === 0) throw new Error('llm-qwen: baseURL must be non-empty')
  const defaultContextWindow = config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  if (!Number.isInteger(defaultContextWindow) || defaultContextWindow <= 0) {
    throw new Error('llm-qwen: defaultContextWindow must be a positive integer')
  }
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('llm-qwen: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-qwen: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return {
    baseURL: config.baseURL,
    modelId: config.modelId ?? DEFAULT_MODEL_ID,
    defaultContextWindow,
    maxTokens,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-qwen: retryPolicy'),
  }
}

/**
 * The protocol error codes for transport/streaming failures.
 */
const STREAM_CLOSED_CODE = 'LLM_STREAM_CLOSED'
const TRANSPORT_CODE = 'LLM_TRANSPORT'

/**
 * Map an OpenAI-wire finish_reason to the harness FinishReason.
 * @param reason - the OpenAI finish_reason string.
 * @returns the mapped reason; unrecognized values become `{kind: 'error'}` with the uppercased value as `code`.
 */
export function toFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls':
    case 'function_call': return { kind: 'tool-calls' }
    case 'length':
    case 'max_tokens': return { kind: 'max-tokens' }
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason ?? 'unknown'}`, code: 'STOP_REASON' },
      }
  }
}

/**
 * Map an OpenAI-wire usage object to the harness TokenUsage. OpenAI names the
 * counts `prompt_tokens`/`completion_tokens`; the harness names them
 * `inputTokens`/`outputTokens`. Reasoning tokens (when present) map too.
 * @param usage - the provider usage object.
 * @returns a harness-compatible TokenUsage.
 */
export function mapTokenUsage(usage: Readonly<Record<string, unknown>>): TokenUsage {
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const reasoning = usage.reasoning_tokens
  const reasoningTokens = typeof reasoning === 'number' ? reasoning : undefined
  return {
    inputTokens: num(usage.prompt_tokens),
    outputTokens: num(usage.completion_tokens),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

/**
 * `QwenAdapter`: streams chat-completions (SSE when the server honors
 * `stream: true`, else a single JSON body) and maps chunks to harness
 * StreamChunks.
 */
export class QwenAdapter extends LlmAdapter {
  constructor(private readonly config: QwenAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Qwen (torch-native)' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const connection = this.config.options()
    return Promise.resolve([
      {
        provider,
        id: connection.modelId,
        name: connection.modelId,
        inputModalities: ['text'],
      },
    ])
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    if (model !== connection.modelId) {
      throw new LlmError(`llm-qwen provider does not own model "${model}"`, 'UNKNOWN_MODEL')
    }
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      context: { contextWindow: connection.defaultContextWindow },
      ...{ defaultMaxTokens: connection.maxTokens },
    })
  }

  /**
   * Build the wire request body from harness GenerateOptions.
   * @param options - the harness request.
   * @param connection - resolved connection facts.
   * @returns the OpenAI-compatible chat-completions request body.
   */
  private requestBody(options: GenerateOptions, connection: QwenConnectionOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: connection.modelId,
      messages: options.messages,
      stream: true,
    }
    if (options.system !== undefined && options.system.length > 0) {
      // Prepend a system message if the request carries one.
      body.messages = [
        { role: 'system', content: options.system },
        ...(options.messages as unknown[]),
      ]
    }
    if (options.tools !== undefined && options.tools.length > 0) {
      body.tools = options.tools
    }
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options.stop !== undefined) body.stop = options.stop
    return body
  }

  /**
   * Stream one model call as harness chunks.
   * @param options - the full request; `options.provider` selects this adapter.
   * @returns the chunk stream.
   */
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const connection = this.config.options()
    const token = (await this.config.resolveToken?.(connection) ?? '')
    const url = `${connection.baseURL.replace(/\/$/, '')}/v1/chat/completions`
    const payload = JSON.stringify(this.requestBody(options, connection))

    const controller = new AbortController()
    const signal = options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal])

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'text/event-stream',
          ...(token.length > 0 ? { authorization: `Bearer ${token}` } : {}),
        },
        body: payload,
        signal,
      })
    } catch (error) {
      throw new LlmError(`llm-qwen: request to ${url} failed`, TRANSPORT_CODE, { cause: error })
    }

    if (response.status < 200 || response.status >= 300 || !response.body) {
      const text = await response.text().catch(() => '')
      const detail = this.config.readError?.(response.status, text)
      throw new LlmError(
        detail ?? `llm-qwen: provider returned HTTP ${response.status}`,
        TRANSPORT_CODE,
      )
    }

    let exhausted = false

    try {
      // Try SSE first; if the server ignored `stream`, parseSse yields one
      // `body` event with the JSON completion.
      for await (const event of parseSse(response.body)) {
        if (event.kind === 'body') {
          const parsed = parseFallbackBody(event.json)
          yield* this.chunkFromFallback(parsed)
          exhausted = true
          return
        }
        if (event.kind === 'done') {
          exhausted = true
          yield { type: 'finish', reason: { kind: 'stop' as const } }
          return
        }
        // event.kind === 'chunk'
        for (const chunk of this.chunkFromSse(event.json)) {
          yield chunk
          if (chunk.type === 'finish') {
            exhausted = true
            return
          }
        }
      }
    } catch (error) {
      if (error instanceof LlmStreamClosedError) {
        throw new LlmError(error.message, STREAM_CLOSED_CODE, { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('llm-qwen: request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError(`llm-qwen: stream from ${url} failed`, TRANSPORT_CODE, { cause: error })
    } finally {
      controller.abort('llm-qwen stream consumer stopped')
    }

    // The SSE stream exhausted without a terminal [DONE] — truncation.
    if (!exhausted && !options.signal?.aborted) {
      throw new LlmError('llm-qwen: SSE stream ended without [DONE]', STREAM_CLOSED_CODE)
    }
  }

  /**
   * Map one SSE chunk event to harness chunks.
   * @param json - the parsed event JSON.
   * @returns harness chunks (possibly several, or a finish).
   */
  private * chunkFromSse(json: Record<string, unknown>): Generator<StreamChunk> {
    const choices = json.choices as Array<Record<string, unknown>> | undefined
    const delta = choices?.[0]?.delta as Record<string, unknown> | undefined
    if (!delta) {
      // A usage-only chunk.
      const usage = json.usage
      if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
        yield { type: 'usage', usage: mapTokenUsage(usage as Record<string, unknown>) }
      }
      return
    }
    const reasoning = delta.reasoning_content
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      yield { type: 'reasoning-delta', index: 0, text: reasoning }
    }
    const content = delta.content
    if (typeof content === 'string' && content.length > 0) {
      yield { type: 'text-delta', index: 0, text: content }
    }
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
    if (toolCalls) {
      for (const call of toolCalls) {
        const fn = call.function as Record<string, unknown> | undefined
        const name = typeof fn?.name === 'string' ? fn.name : undefined
        const args = typeof fn?.arguments === 'string' ? fn.arguments : ''
        if (name || args) {
          yield {
            type: 'tool-call-delta',
            index: 0,
            id: CallId(call.id && typeof call.id === 'string' ? call.id : 'call_unknown'),
            ...(name !== undefined ? { name } : {}),
            argumentsDelta: args,
          }
        }
      }
    }
    const finish = choices?.[0]?.finish_reason as string | undefined
    if (finish) {
      yield { type: 'finish', reason: toFinishReason(finish) }
    }
  }

  /**
   * Map a fallback (non-streaming) chat-completions body to harness chunks.
   * @param parsed - `{ choices, usage }` from the JSON body.
   * @returns a text-delta (or tool-call), usage, then finish.
   */
  private * chunkFromFallback(parsed: {
    choices?: Array<Record<string, unknown>>
    usage?: Record<string, number>
  }): Generator<StreamChunk> {
    const message = parsed.choices?.[0]?.message as Record<string, unknown> | undefined
    const finish = parsed.choices?.[0]?.finish_reason as string | undefined
    const reasoning = typeof message?.reasoning_content === 'string' ? message.reasoning_content : undefined
    if (reasoning) yield { type: 'reasoning-delta', index: 0, text: reasoning }
    const content = typeof message?.content === 'string' ? message.content : undefined
    if (content) yield { type: 'text-delta', index: 0, text: content }
    const toolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined
    if (toolCalls) {
      for (const call of toolCalls) {
        const fn = call.function as Record<string, unknown> | undefined
        const name = typeof fn?.name === 'string' ? fn.name : undefined
        const args = typeof fn?.arguments === 'string' ? fn.arguments : ''
        yield {
          type: 'tool-call-delta',
          index: 0,
          id: CallId(call.id && typeof call.id === 'string' ? call.id : 'call_unknown'),
          ...(name !== undefined ? { name } : {}),
          argumentsDelta: args,
        }
      }
    }
    if (parsed.usage) yield { type: 'usage', usage: mapTokenUsage(parsed.usage) }
    yield { type: 'finish', reason: toFinishReason(finish) }
  }
}
