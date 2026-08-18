/**
 * SSE and fallback-body decoding for the Qwen adapter.
 *
 * The torch-native server is expected to honor `stream: true` and emit OpenAI
 * SSE (`data: {json}\n\n`, terminal `data: [DONE]\n\n`). But the server may
 * ignore `stream` and return a plain JSON chat-completions body. This module
 * decodes both: an SSE byte stream yields per-event payloads, classifying each
 * as a data chunk, the `[DONE]` sentinel, or — when the body was never SSE at
 * all — a single JSON object to parse as a fallback completion.
 *
 * @module @deepseek-ai/dsh-llm-qwen/sse
 */

/** One decoded SSE event. */
export type SseEvent =
  | { kind: 'chunk'; json: Record<string, unknown> }
  | { kind: 'done' }
  | { kind: 'body'; json: Record<string, unknown> }

const DONE = '[DONE]'

/** Parsed JSON payload inside a `data:` SSE line, or the raw string. */
function parseDataLine(payload: string): { json?: Record<string, unknown>; done?: boolean } {
  const trimmed = payload.trim()
  if (trimmed === DONE) return { done: true }
  if (trimmed.length === 0) return {}
  try {
    const value = JSON.parse(trimmed)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { json: value as Record<string, unknown> }
    }
  } catch {
    // not JSON — ignore trailing data
  }
  return {}
}

/**
 * Read a raw SSE byte stream into decoded events. Detects a non-SSE plain-JSON
 * body and yields exactly one `body` event for it, so the caller can parse a
 * fallback completion.
 * @param stream - raw SSE bytes; reads may split anywhere, including mid-UTF-8.
 * @returns decoded events in arrival order.
 */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDataLine = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep: number
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            sawDataLine = true
            const parsed = parseDataLine(line.slice(5))
            if (parsed.done) yield { kind: 'done' }
            else if (parsed.json) yield { kind: 'chunk', json: parsed.json }
          }
          // event:/id:/retry:/comment lines are ignored.
        }
      }
    }

    // Tail after the last blank line.
    if (buffer.length > 0) {
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data:')) {
          sawDataLine = true
          const parsed = parseDataLine(line.slice(5))
          if (parsed.done) yield { kind: 'done' }
          else if (parsed.json) yield { kind: 'chunk', json: parsed.json }
        }
      }
    }

    // If the whole body was a single JSON object (no data: lines), it was a
    // fallback chat-completions body, not SSE.
    if (!sawDataLine) {
      const tail = decoder.decode()
      const whole = (buffer + tail).trim()
      if (whole.startsWith('{')) {
        try {
          yield { kind: 'body', json: JSON.parse(whole) as Record<string, unknown> }
        } catch {
          throw new LlmStreamClosedError('llm-qwen: response was neither SSE nor JSON')
        }
      }
      if (whole.length > 0 && !whole.startsWith('{')) {
        throw new LlmStreamClosedError('llm-qwen: unrecognized response body')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Error raised when an SSE stream ends without a terminal event the caller expects. */
export class LlmStreamClosedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmStreamClosedError'
  }
}

/**
 * Parse a fallback (non-streaming) chat-completions JSON body.
 * @param json - the parsed body.
 * @returns `{ choices, usage }` subset.
 */
export function parseFallbackBody(json: Record<string, unknown>): {
  choices?: Array<Record<string, unknown>>
  usage?: Record<string, number>
} {
  const choices = Array.isArray(json.choices)
    ? json.choices as Array<Record<string, unknown>>
    : undefined
  const usage = json.usage && typeof json.usage === 'object'
    ? json.usage as Record<string, number>
    : undefined
  return {
    ...(choices === undefined ? {} : { choices }),
    ...(usage === undefined ? {} : { usage }),
  }
}
